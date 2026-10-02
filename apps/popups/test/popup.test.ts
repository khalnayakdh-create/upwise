import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import type { D1Database } from "@cloudflare/workers-types";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, platformMigrations, runMigrations } from "@upwise/platform";
import { appMigrations } from "../app/lib/schema";
import {
  bump, DEFAULT_CONFIG, getConfig, purgePopupsShop, saveConfig, signupsThisMonth, stats,
  storefrontConfig, validateConfig, validEmail, screenSignup, uniqueCode, MIN_FILL_MS,
} from "../app/lib/popup.server";
import { isDisposable } from "../app/lib/disposable";
import { PLAN_LIMITS } from "../app/lib/plans";

const proxy = await getPlatformProxy<{ DB: D1Database }>({
  configPath: join(import.meta.dirname, "../../../packages/platform/test/wrangler.test.jsonc"),
  persist: { path: mkdtempSync(join(tmpdir(), "storevine-popups-")) },
});
const d1 = proxy.env.DB;
const db = getDb(d1);
const SHOP = "a.myshopify.com";
afterAll(() => proxy.dispose());
beforeEach(async () => {
  await runMigrations(d1, [...platformMigrations, ...appMigrations]);
  await d1.batch([d1.prepare("DELETE FROM app_setting"), d1.prepare("DELETE FROM popup_stat_daily")]);
});

describe("validateConfig", () => {
  it("clamps numbers, sanitizes code and color, defaults blanks", () => {
    const c = validateConfig({ enabled: "on", headline: "", trigger: "scroll", delaySeconds: "999", scrollPercent: "5", frequencyDays: "-3", discountCode: "SAVE 10%!", accentColor: "red" });
    expect(c).toMatchObject({ enabled: true, headline: DEFAULT_CONFIG.headline, trigger: "scroll", delaySeconds: 120, scrollPercent: 10, frequencyDays: 0, discountCode: "SAVE10", accentColor: DEFAULT_CONFIG.accentColor });
  });
  it("treats missing switch as disabled and unknown trigger as delay", () => {
    expect(validateConfig({ trigger: "nope" })).toMatchObject({ enabled: false, trigger: "delay" });
  });
});

describe("validEmail", () => {
  it("normalizes and validates", () => {
    expect(validEmail("  Ann@Example.COM ")).toBe("ann@example.com");
    expect(validEmail("no-at-sign")).toBeNull();
    expect(validEmail("a@b")).toBeNull();
    expect(validEmail(`${"x".repeat(250)}@example.com`)).toBeNull();
  });
});

describe("storage and stats", () => {
  it("persists config and builds the storefront payload with branding flag", async () => {
    expect(await getConfig(db, SHOP)).toEqual(DEFAULT_CONFIG);
    await saveConfig(db, SHOP, { ...DEFAULT_CONFIG, enabled: true, headline: "Hi" });
    const c = await getConfig(db, SHOP);
    expect(c.headline).toBe("Hi");
    expect(storefrontConfig(c, true)).toMatchObject({ v: 1, enabled: true, branding: true });
    expect(storefrontConfig({ ...c, discountCode: "SECRET10" }, true)).not.toHaveProperty("discountCode");
  });
  it("counts impressions and sign-ups per day and month", async () => {
    await bump(db, SHOP, "impressions", 3);
    await bump(db, SHOP, "signups");
    await bump(db, SHOP, "signups");
    expect(await stats(db, SHOP)).toEqual({ impressions: 3, signups: 2, blocked: 0 });
    expect(await signupsThisMonth(db, SHOP)).toBe(2);
    await purgePopupsShop(db, SHOP);
    expect(await stats(db, SHOP)).toEqual({ impressions: 0, signups: 0, blocked: 0 });
  });
});

describe("bot shield and codes", () => {
  const good = { email: "Ann@Example.com", consent: true, elapsed: 4000 };
  it("passes a real sign-up", () => {
    expect(screenSignup(good, isDisposable)).toEqual({ ok: true, email: "ann@example.com" });
  });
  it("silently blocks bots", () => {
    expect(screenSignup({ ...good, website: "x" }, isDisposable)).toEqual({ ok: false, blocked: "honeypot" });
    expect(screenSignup({ ...good, elapsed: MIN_FILL_MS - 1 }, isDisposable)).toEqual({ ok: false, blocked: "too_fast" });
  });
  it("rejects throwaway domains with a message", () => {
    const r = screenSignup({ ...good, email: "a@mailinator.com" }, isDisposable);
    expect(r).toMatchObject({ ok: false, blocked: "disposable" });
    expect(isDisposable("x@inbox.mailinator.com")).toBe(true);
    expect(isDisposable("x@gmail.com")).toBe(false);
  });
  it("still asks for consent and a valid email", () => {
    expect(screenSignup({ ...good, consent: false }, isDisposable)).toMatchObject({ ok: false, status: 400 });
    expect(screenSignup({ ...good, email: "nope" }, isDisposable)).toMatchObject({ ok: false, status: 400 });
  });
  it("makes readable unique codes", () => {
    const a = uniqueCode();
    expect(a).toMatch(/^WELCOME-[2-9A-HJ-NP-Z]{8}$/);
    expect(uniqueCode()).not.toBe(a);
  });
  it("validates new settings and gates unique codes by plan", () => {
    const c = validateConfig({ signedIn: "unsubscribed", codeMode: "unique", uniquePercent: "200", uniqueDays: "0" });
    expect(c).toMatchObject({ signedIn: "unsubscribed", codeMode: "unique", uniquePercent: 90, uniqueDays: 30 });
    expect(validateConfig({}).signedIn).toBe("hide");
    expect(storefrontConfig(c, true)).toMatchObject({ signedIn: "unsubscribed" });
    expect(storefrontConfig(c, true)).not.toHaveProperty("uniquePercent");
    expect(PLAN_LIMITS.free.uniqueCodes).toBe(false);
  });
  it("counts blocked sign-ups", async () => {
    await bump(db, SHOP, "blocked", 3);
    expect((await stats(db, SHOP)).blocked).toBe(3);
  });
});
