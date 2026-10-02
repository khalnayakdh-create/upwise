import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@upwise/platform";
import { appSettingTable, popupStatTable } from "./schema";

export interface PopupConfig {
  enabled: boolean;
  headline: string;
  body: string;
  buttonLabel: string;
  successMessage: string;
  discountCode: string;
  consentText: string;
  trigger: "delay" | "exit" | "scroll";
  delaySeconds: number;
  scrollPercent: number;
  frequencyDays: number;
  pages: "all" | "home";
  accentColor: string;
  /** Signed-in customers: hide the pop-up, or show it only to those not yet subscribed (email prefilled). */
  signedIn: "hide" | "unsubscribed";
  /** "static" = the same code for everyone; "unique" = a single-use code per sign-up (Growth). */
  codeMode: "static" | "unique";
  /** Unique codes: percent off, days valid. */
  uniquePercent: number;
  uniqueDays: number;
}

export const DEFAULT_CONFIG: PopupConfig = {
  enabled: false,
  headline: "Get 10% off your first order",
  body: "Join our list for new arrivals and offers.",
  buttonLabel: "Sign up",
  successMessage: "Thanks for signing up!",
  discountCode: "",
  consentText: "By signing up you agree to receive marketing emails. Unsubscribe anytime.",
  trigger: "delay",
  delaySeconds: 8,
  scrollPercent: 50,
  frequencyDays: 7,
  pages: "all",
  accentColor: "#111111",
  signedIn: "hide",
  codeMode: "static",
  uniquePercent: 10,
  uniqueDays: 30,
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const str = (v: unknown, max: number, fallback = "") => {
  const s = String(v ?? "").trim().slice(0, max);
  return s || fallback;
};

export function validateConfig(raw: Record<string, unknown>): PopupConfig {
  const trigger = raw.trigger === "exit" || raw.trigger === "scroll" ? raw.trigger : "delay";
  const color = String(raw.accentColor ?? "");
  return {
    enabled: raw.enabled === "on" || raw.enabled === true,
    headline: str(raw.headline, 80, DEFAULT_CONFIG.headline),
    body: str(raw.body, 240),
    buttonLabel: str(raw.buttonLabel, 30, DEFAULT_CONFIG.buttonLabel),
    successMessage: str(raw.successMessage, 160, DEFAULT_CONFIG.successMessage),
    discountCode: str(raw.discountCode, 40).replace(/[^A-Za-z0-9_-]/g, ""),
    consentText: str(raw.consentText, 240, DEFAULT_CONFIG.consentText),
    trigger,
    delaySeconds: clamp(Number.parseInt(String(raw.delaySeconds ?? ""), 10) || 0, 0, 120),
    scrollPercent: clamp(Number.parseInt(String(raw.scrollPercent ?? ""), 10) || 50, 10, 100),
    frequencyDays: clamp(Number.parseInt(String(raw.frequencyDays ?? ""), 10) || 0, 0, 365),
    pages: raw.pages === "home" ? "home" : "all",
    accentColor: /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_CONFIG.accentColor,
    signedIn: raw.signedIn === "unsubscribed" ? "unsubscribed" : "hide",
    codeMode: raw.codeMode === "unique" ? "unique" : "static",
    uniquePercent: clamp(Number.parseInt(String(raw.uniquePercent ?? ""), 10) || DEFAULT_CONFIG.uniquePercent, 1, 90),
    uniqueDays: clamp(Number.parseInt(String(raw.uniqueDays ?? ""), 10) || DEFAULT_CONFIG.uniqueDays, 1, 365),
  };
}

export async function getConfig(db: Db, shop: string): Promise<PopupConfig> {
  const [row] = await db
    .select({ value: appSettingTable.value })
    .from(appSettingTable)
    .where(and(eq(appSettingTable.shop, shop), eq(appSettingTable.key, "popup")));
  if (!row) return DEFAULT_CONFIG;
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(row.value) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(db: Db, shop: string, config: PopupConfig) {
  const value = JSON.stringify(config);
  await db
    .insert(appSettingTable)
    .values({ shop, key: "popup", value })
    .onConflictDoUpdate({ target: [appSettingTable.shop, appSettingTable.key], set: { value } });
}

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

export async function bump(db: Db, shop: string, field: "impressions" | "signups" | "blocked", n = 1, now = new Date()) {
  const day = utcDay(now);
  await db
    .insert(popupStatTable)
    .values({ shop, day, impressions: field === "impressions" ? n : 0, signups: field === "signups" ? n : 0, blocked: field === "blocked" ? n : 0 })
    .onConflictDoUpdate({
      target: [popupStatTable.shop, popupStatTable.day],
      set: { [field]: sql`${popupStatTable[field]} + ${n}` },
    });
}

export async function stats(db: Db, shop: string, days = 30, now = new Date()) {
  const since = utcDay(new Date(now.getTime() - (days - 1) * 86_400_000));
  const [row] = await db
    .select({
      impressions: sql<number>`coalesce(sum(${popupStatTable.impressions}), 0)`,
      signups: sql<number>`coalesce(sum(${popupStatTable.signups}), 0)`,
      blocked: sql<number>`coalesce(sum(${popupStatTable.blocked}), 0)`,
    })
    .from(popupStatTable)
    .where(and(eq(popupStatTable.shop, shop), gte(popupStatTable.day, since)));
  return { impressions: Number(row?.impressions ?? 0), signups: Number(row?.signups ?? 0), blocked: Number(row?.blocked ?? 0) };
}

export async function signupsThisMonth(db: Db, shop: string, now = new Date()) {
  const start = `${now.toISOString().slice(0, 7)}-01`;
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${popupStatTable.signups}), 0)` })
    .from(popupStatTable)
    .where(and(eq(popupStatTable.shop, shop), gte(popupStatTable.day, start)));
  return Number(row?.n ?? 0);
}

export async function purgePopupsShop(db: Db, shop: string) {
  await db.delete(appSettingTable).where(eq(appSettingTable.shop, shop));
  await db.delete(popupStatTable).where(eq(popupStatTable.shop, shop));
}

/** Storefront payload (app-data metafield). */
export function storefrontConfig(config: PopupConfig, branding: boolean) {
  // The discount code is deliberately NOT included: it's returned only after a successful sign-up.
  const { enabled, headline, body, buttonLabel, successMessage, consentText, trigger, delaySeconds, scrollPercent, frequencyDays, pages, accentColor, signedIn } = config;
  return { v: 1, enabled, headline, body, buttonLabel, successMessage, consentText, trigger, delaySeconds, scrollPercent, frequencyDays, pages, accentColor, signedIn, branding };
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
export function validEmail(raw: unknown): string | null {
  const email = String(raw ?? "").trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

/* ---------- bot shield ---------- */

/** Real people take at least this long between the pop-up opening and submitting. */
export const MIN_FILL_MS = 1500;

export type ScreenResult =
  | { ok: true; email: string }
  | { ok: false; blocked: "honeypot" | "too_fast" | "disposable"; error?: string }
  | { ok: false; blocked?: undefined; error: string; status: number };

/**
 * Check a sign-up before touching Shopify. Bot hits get a fake success (so the
 * bot learns nothing) and are counted as blocked; real input errors get a message.
 */
export function screenSignup(body: Record<string, unknown>, isDisposable: (email: string) => boolean): ScreenResult {
  if (body.website) return { ok: false, blocked: "honeypot" };
  const elapsed = Number(body.elapsed);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_FILL_MS) return { ok: false, blocked: "too_fast" };
  if (body.consent !== true) return { ok: false, error: "Please agree to receive emails.", status: 400 };
  const email = validEmail(body.email);
  if (!email) return { ok: false, error: "Enter a valid email address.", status: 400 };
  if (isDisposable(email)) return { ok: false, blocked: "disposable", error: "Please use a permanent email address." };
  return { ok: true, email };
}

/** Readable unique code, e.g. WELCOME-7KQ4M9TX (no 0/O/1/I). */
export function uniqueCode(prefix = "WELCOME") {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `${prefix}-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`;
}
