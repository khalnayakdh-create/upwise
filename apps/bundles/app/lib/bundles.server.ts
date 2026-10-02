import { and, asc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@upwise/platform";
import { appSettingTable, bundleOrderTable, bundleStatTable, bundleTable } from "./schema";
import { PLAN_LIMITS, type PlanKey } from "./plans";

export interface BundleProduct {
  productId: string;
  variantId: string;
  handle: string;
  title: string;
  image: string | null;
}

import { MAX_TIERS, PRODUCT_LIMITS, type BundleType, type Tier } from "./bundle-types";
export { MAX_TIERS, PRODUCT_LIMITS, type BundleType, type Tier };

export interface Bundle {
  id: string;
  shop: string;
  name: string;
  title: string;
  status: "active" | "paused";
  type: BundleType;
  products: BundleProduct[];
  discountPercent: number;
  tiers: Tier[];
  createdAt: string;
  updatedAt: string;
}

export interface BundleInput {
  name: string;
  title: string;
  status: "active" | "paused";
  type: BundleType;
  productIds: string[];
  discountPercent: number;
  tiers: Tier[];
}


const DEFAULT_TITLES: Record<BundleType, string> = { fixed: "Frequently bought together", volume: "Buy more, save more" };

/** Parse and validate volume tiers: 1-4 tiers, min 2-100 strictly increasing, percent 1-90 not decreasing. */
export function parseTiers(raw: unknown): { tiers: Tier[]; error?: string } {
  let list: unknown;
  try {
    list = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
  } catch {
    return { tiers: [], error: "Add at least one discount level." };
  }
  if (!Array.isArray(list)) return { tiers: [], error: "Add at least one discount level." };
  const tiers = list
    .map((t) => ({ min: Math.floor(Number((t as Tier)?.min)), percent: Math.floor(Number((t as Tier)?.percent)) }))
    .filter((t) => Number.isFinite(t.min) && Number.isFinite(t.percent) && (t.min || t.percent));
  if (!tiers.length) return { tiers, error: "Add at least one discount level." };
  if (tiers.length > MAX_TIERS) return { tiers, error: `Use up to ${MAX_TIERS} discount levels.` };
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    if (t.min < 2 || t.min > 100) return { tiers, error: "Quantities must be between 2 and 100." };
    if (t.percent < 1 || t.percent > 90) return { tiers, error: "Discounts must be between 1% and 90%." };
    if (i > 0 && t.min <= tiers[i - 1].min) return { tiers, error: "Each level needs a higher quantity than the one before." };
    if (i > 0 && t.percent < tiers[i - 1].percent) return { tiers, error: "A higher quantity can't have a smaller discount." };
  }
  return { tiers };
}

const GID = /^gid:\/\/shopify\/Product\/\d+$/;

function toBundle(row: typeof bundleTable.$inferSelect): Bundle {
  let products: BundleProduct[] = [];
  try {
    products = JSON.parse(row.products);
  } catch {
    products = [];
  }
  return {
    ...row,
    type: row.type === "volume" ? "volume" : "fixed",
    products: Array.isArray(products) ? products : [],
    tiers: parseTiers(row.tiers).tiers,
  };
}

export function validateBundleInput(raw: Record<string, unknown>) {
  const errors: Record<string, string> = {};
  let ids: string[] = [];
  try {
    const parsed = JSON.parse(String(raw.productIds ?? "[]"));
    ids = Array.isArray(parsed) ? [...new Set(parsed.filter((v): v is string => typeof v === "string" && GID.test(v)))] : [];
  } catch {
    ids = [];
  }
  const type: BundleType = raw.type === "volume" ? "volume" : "fixed";
  const { tiers, error: tierError } = type === "volume" ? parseTiers(raw.tiers) : { tiers: [] as Tier[], error: undefined };
  const input: BundleInput = {
    name: String(raw.name ?? "").trim().slice(0, 80),
    title: String(raw.title ?? "").trim().slice(0, 80) || DEFAULT_TITLES[type],
    status: raw.status === "active" ? "active" : "paused",
    type,
    productIds: ids,
    discountPercent: type === "fixed" ? Math.max(0, Math.min(90, Number.parseInt(String(raw.discountPercent ?? "0"), 10) || 0)) : 0,
    tiers,
  };
  const limit = PRODUCT_LIMITS[type];
  if (!input.name) errors.name = "Give the bundle a name (only you see it).";
  if (ids.length < limit.min) errors.productIds = limit.min === 1 ? "Pick at least 1 product." : `Pick at least ${limit.min} products.`;
  if (ids.length > limit.max) errors.productIds = `This bundle type can have up to ${limit.max} products.`;
  if (tierError) errors.tiers = tierError;
  return { input, errors };
}

export async function listBundles(db: Db, shop: string) {
  const rows = await db.select().from(bundleTable).where(eq(bundleTable.shop, shop)).orderBy(asc(bundleTable.createdAt));
  return rows.map(toBundle);
}

export async function getBundle(db: Db, shop: string, id: string) {
  const [row] = await db.select().from(bundleTable).where(and(eq(bundleTable.shop, shop), eq(bundleTable.id, id)));
  return row ? toBundle(row) : null;
}

export async function saveBundle(db: Db, shop: string, id: string | null, input: BundleInput, products: BundleProduct[], now = new Date()) {
  const values = {
    name: input.name,
    title: input.title,
    status: input.status,
    products: JSON.stringify(products),
    discountPercent: input.discountPercent,
    type: input.type,
    tiers: JSON.stringify(input.tiers),
    updatedAt: now.toISOString(),
  };
  if (id) {
    await db.update(bundleTable).set(values).where(and(eq(bundleTable.shop, shop), eq(bundleTable.id, id)));
    return id;
  }
  const newId = crypto.randomUUID();
  await db.insert(bundleTable).values({ id: newId, shop, createdAt: now.toISOString(), ...values });
  return newId;
}

export async function deleteBundle(db: Db, shop: string, id: string) {
  await db.delete(bundleTable).where(and(eq(bundleTable.shop, shop), eq(bundleTable.id, id)));
  await db.delete(bundleStatTable).where(and(eq(bundleStatTable.shop, shop), eq(bundleStatTable.bundleId, id)));
  await db.delete(bundleOrderTable).where(and(eq(bundleOrderTable.shop, shop), eq(bundleOrderTable.bundleId, id)));
}

export async function countActive(db: Db, shop: string, excludeId?: string) {
  return (await listBundles(db, shop)).filter((b) => b.status === "active" && b.id !== excludeId).length;
}

export async function purgeBundlesShop(db: Db, shop: string) {
  await db.delete(bundleTable).where(eq(bundleTable.shop, shop));
  await db.delete(bundleStatTable).where(eq(bundleStatTable.shop, shop));
  await db.delete(bundleOrderTable).where(eq(bundleOrderTable.shop, shop));
  await db.delete(appSettingTable).where(eq(appSettingTable.shop, shop));
}

const num = (gid: string) => Number(gid.split("/").pop());

export function liveBundles(bundles: Bundle[], plan: PlanKey) {
  return bundles
    .filter((b) => b.status === "active" && b.products.length >= PRODUCT_LIMITS[b.type].min && (b.type === "fixed" || b.tiers.length > 0))
    .slice(0, PLAN_LIMITS[plan].maxActiveBundles);
}

/** Storefront config (app-data metafield) read by the theme block. */
export function storefrontConfig(bundles: Bundle[], plan: PlanKey) {
  return {
    v: 2,
    bundles: liveBundles(bundles, plan).map((b) => ({
      id: b.id,
      type: b.type,
      title: b.title,
      discountPercent: b.discountPercent,
      tiers: b.tiers,
      products: b.products.map((p) => ({ handle: p.handle, productId: num(p.productId), variantId: num(p.variantId) })),
    })),
  };
}

/** Discount Function config (discount metafield). */
export function discountConfig(bundles: Bundle[], plan: PlanKey) {
  const live = liveBundles(bundles, plan);
  return {
    bundles: live
      .filter((b) => b.type === "fixed" && b.discountPercent > 0)
      .map((b) => ({ id: b.id, percent: b.discountPercent, message: `${b.title}: ${b.discountPercent}% off`, productIds: b.products.map((p) => p.productId) })),
    volume: live
      .filter((b) => b.type === "volume")
      .map((b) => ({ id: b.id, message: b.title, tiers: b.tiers, productIds: b.products.map((p) => p.productId) })),
  };
}

/** True when the discount config has anything for the Function to apply. */
export const hasDiscounts = (c: ReturnType<typeof discountConfig>) => c.bundles.length > 0 || c.volume.length > 0;

export async function getSetting(db: Db, shop: string, key: string) {
  const [row] = await db.select({ value: appSettingTable.value }).from(appSettingTable).where(and(eq(appSettingTable.shop, shop), eq(appSettingTable.key, key)));
  return row?.value ?? null;
}

export async function setSetting(db: Db, shop: string, key: string, value: string) {
  await db.insert(appSettingTable).values({ shop, key, value }).onConflictDoUpdate({ target: [appSettingTable.shop, appSettingTable.key], set: { value } });
}

const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

export async function recordBundleEvents(db: Db, shop: string, events: Array<{ bundleId: string; type: "impression" | "add" }>, valid: Set<string>, now = new Date()) {
  const day = utcDay(now);
  const counts = new Map<string, { impressions: number; adds: number }>();
  for (const e of events) {
    if (!valid.has(e.bundleId)) continue;
    const c = counts.get(e.bundleId) ?? { impressions: 0, adds: 0 };
    if (e.type === "impression") c.impressions++;
    else if (e.type === "add") c.adds++;
    counts.set(e.bundleId, c);
  }
  for (const [bundleId, c] of counts) {
    await db
      .insert(bundleStatTable)
      .values({ shop, bundleId, day, ...c })
      .onConflictDoUpdate({
        target: [bundleStatTable.shop, bundleStatTable.bundleId, bundleStatTable.day],
        set: { impressions: sql`${bundleStatTable.impressions} + ${c.impressions}`, adds: sql`${bundleStatTable.adds} + ${c.adds}` },
      });
  }
}

export async function bundleStats(db: Db, shop: string, days = 30, now = new Date()) {
  const since = utcDay(new Date(now.getTime() - (days - 1) * 86_400_000));
  const rows = await db
    .select({ bundleId: bundleStatTable.bundleId, impressions: sql<number>`sum(${bundleStatTable.impressions})`, adds: sql<number>`sum(${bundleStatTable.adds})` })
    .from(bundleStatTable)
    .where(and(eq(bundleStatTable.shop, shop), gte(bundleStatTable.day, since)))
    .groupBy(bundleStatTable.bundleId);
  return new Map(rows.map((r) => [r.bundleId, { impressions: Number(r.impressions), adds: Number(r.adds) }]));
}

// ---------------------------------------------------------------- sales report

interface OrderLine {
  quantity?: number;
  price?: string;
  price_set?: { shop_money?: { amount?: string; currency_code?: string } };
  properties?: Array<{ name?: string; value?: unknown }> | Record<string, unknown> | null;
  discount_allocations?: Array<{ amount?: string; amount_set?: { shop_money?: { amount?: string } } }>;
}
interface OrderPayload {
  id?: number | string;
  admin_graphql_api_id?: string;
  created_at?: string;
  currency?: string;
  test?: boolean;
  line_items?: OrderLine[];
}

const cents = (amount: unknown) => Math.round(Number(amount ?? 0) * 100) || 0;

function bundleIdOf(line: OrderLine): string | null {
  const props = line.properties;
  if (!props) return null;
  const value = Array.isArray(props)
    ? props.find((p) => p?.name === "_storevine_bundle")?.value
    : (props as Record<string, unknown>)["_storevine_bundle"];
  const id = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f-]{36}$/.test(id) ? id : null;
}

/** Sum an orders/create payload's bundle lines per bundle (shop currency, after line discounts). */
export function parseBundleOrder(payload: unknown) {
  const o = (payload ?? {}) as OrderPayload;
  const orderId = o.admin_graphql_api_id || (o.id ? `gid://shopify/Order/${o.id}` : "");
  const rows = new Map<string, { units: number; revenueCents: number; discountCents: number; currency: string }>();
  for (const line of o.line_items ?? []) {
    const bundleId = bundleIdOf(line);
    if (!bundleId) continue;
    const qty = Math.max(0, Math.floor(Number(line.quantity ?? 0)));
    const unit = cents(line.price_set?.shop_money?.amount ?? line.price);
    const discount = (line.discount_allocations ?? []).reduce((n, d) => n + cents(d.amount_set?.shop_money?.amount ?? d.amount), 0);
    const currency = line.price_set?.shop_money?.currency_code || o.currency || "USD";
    const r = rows.get(bundleId) ?? { units: 0, revenueCents: 0, discountCents: 0, currency };
    r.units += qty;
    r.revenueCents += unit * qty - discount;
    r.discountCents += discount;
    rows.set(bundleId, r);
  }
  return { orderId, day: String(o.created_at ?? new Date().toISOString()).slice(0, 10), rows };
}

/** Store one order's bundle totals. Idempotent per (order, bundle), so webhook retries don't double count. */
export async function recordBundleOrder(db: Db, shop: string, parsed: ReturnType<typeof parseBundleOrder>, known: Set<string>) {
  if (!parsed.orderId) return 0;
  let n = 0;
  for (const [bundleId, r] of parsed.rows) {
    if (!known.has(bundleId)) continue; // ignore deleted or forged bundle ids
    await db
      .insert(bundleOrderTable)
      .values({ shop, orderId: parsed.orderId, bundleId, day: parsed.day, ...r })
      .onConflictDoNothing();
    n++;
  }
  return n;
}

export interface BundleSales { orders: number; units: number; revenueCents: number; discountCents: number; currency: string }

/** Per-bundle sales over the last `days` days. */
export async function bundleSales(db: Db, shop: string, days = 30, now = new Date()) {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .select({
      bundleId: bundleOrderTable.bundleId,
      orders: sql<number>`count(*)`,
      units: sql<number>`sum(${bundleOrderTable.units})`,
      revenueCents: sql<number>`sum(${bundleOrderTable.revenueCents})`,
      discountCents: sql<number>`sum(${bundleOrderTable.discountCents})`,
      currency: sql<string>`max(${bundleOrderTable.currency})`,
    })
    .from(bundleOrderTable)
    .where(and(eq(bundleOrderTable.shop, shop), gte(bundleOrderTable.day, since)))
    .groupBy(bundleOrderTable.bundleId);
  const out = new Map<string, BundleSales>();
  for (const r of rows) {
    out.set(r.bundleId, {
      orders: Number(r.orders),
      units: Number(r.units),
      revenueCents: Number(r.revenueCents),
      discountCents: Number(r.discountCents),
      currency: r.currency || "USD",
    });
  }
  return out;
}
