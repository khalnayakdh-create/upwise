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
  storefrontConfig, validateConfig, validEmail,
} from "../app/lib/popup.server";

const proxy = await getPlatformProxy<{ DB: D1Database }>({
  configPath: join(import.meta.dirname, "../../../packages/platform/test/wrangler.test.jsonc"),
  persist: { path: mkdtempSync(join(tmpdir(), "upwise-popups-")) },
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
  });
  it("counts impressions and sign-ups per day and month", async () => {
    await bump(db, SHOP, "impressions", 3);
    await bump(db, SHOP, "signups");
    await bump(db, SHOP, "signups");
    expect(await stats(db, SHOP)).toEqual({ impressions: 3, signups: 2 });
    expect(await signupsThisMonth(db, SHOP)).toBe(2);
    await purgePopupsShop(db, SHOP);
    expect(await stats(db, SHOP)).toEqual({ impressions: 0, signups: 0 });
  });
});
