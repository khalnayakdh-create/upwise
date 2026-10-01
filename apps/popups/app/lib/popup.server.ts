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

export async function bump(db: Db, shop: string, field: "impressions" | "signups", n = 1, now = new Date()) {
  const day = utcDay(now);
  await db
    .insert(popupStatTable)
    .values({ shop, day, impressions: field === "impressions" ? n : 0, signups: field === "signups" ? n : 0 })
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
    })
    .from(popupStatTable)
    .where(and(eq(popupStatTable.shop, shop), gte(popupStatTable.day, since)));
  return { impressions: Number(row?.impressions ?? 0), signups: Number(row?.signups ?? 0) };
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
  const { enabled, headline, body, buttonLabel, successMessage, consentText, trigger, delaySeconds, scrollPercent, frequencyDays, pages, accentColor } = config;
  return { v: 1, enabled, headline, body, buttonLabel, successMessage, consentText, trigger, delaySeconds, scrollPercent, frequencyDays, pages, accentColor, branding };
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
export function validEmail(raw: unknown): string | null {
  const email = String(raw ?? "").trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}
