import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@upwise/platform";
import { appSettingTable, offerStatTable, offerTable } from "./schema";
import { PLAN_LIMITS, type PlanKey } from "./plans";
import { purgeAttribution } from "./attribution.server";

export interface OfferProduct {
  productId: string; // gid://shopify/Product/...
  variantId: string; // gid://shopify/ProductVariant/... (first available)
  handle: string;
  title: string;
  image: string | null;
}

export interface Offer {
  id: string;
  shop: string;
  name: string;
  status: "active" | "paused";
  triggerType: "all" | "products";
  triggerProductIds: string[];
  offerProducts: OfferProduct[];
  headline: string;
  priority: number;
  discountPercent: number;
  createdAt: string;
  updatedAt: string;
}

export interface OfferInput {
  name: string;
  status: "active" | "paused";
  triggerType: "all" | "products";
  triggerProductIds: string[];
  offerProductIds: string[];
  headline: string;
  priority: number;
  discountPercent: number;
}

type Row = typeof offerTable.$inferSelect;

function parseIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function rowToOffer(row: Row): Offer {
  let products: OfferProduct[] = [];
  try {
    products = JSON.parse(row.offerProducts);
  } catch {
    products = [];
  }
  return {
    ...row,
    triggerProductIds: parseIds(row.triggerProductIds),
    offerProducts: Array.isArray(products) ? products : [],
  };
}

export async function listOffers(db: Db, shop: string): Promise<Offer[]> {
  const rows = await db
    .select()
    .from(offerTable)
    .where(eq(offerTable.shop, shop))
    .orderBy(desc(offerTable.priority), asc(offerTable.createdAt));
  return rows.map(rowToOffer);
}

export async function getOffer(db: Db, shop: string, id: string): Promise<Offer | null> {
  const [row] = await db
    .select()
    .from(offerTable)
    .where(and(eq(offerTable.shop, shop), eq(offerTable.id, id)));
  return row ? rowToOffer(row) : null;
}

const GID_PRODUCT = /^gid:\/\/shopify\/Product\/\d+$/;

/** Validate untrusted form input. Returns field errors (empty = valid). */
export function validateOfferInput(raw: Record<string, unknown>): {
  input: OfferInput;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const name = String(raw.name ?? "").trim().slice(0, 80);
  const headline = String(raw.headline ?? "").trim().slice(0, 120);
  // s-switch submits "active" only when on; absent means paused.
  const status = raw.status === "active" ? "active" : "paused";
  const triggerType = raw.triggerType === "products" ? "products" : "all";
  const priority = Math.max(0, Math.min(1000, Number.parseInt(String(raw.priority ?? "0"), 10) || 0));
  const toIds = (v: unknown) => {
    const ids = typeof v === "string" ? parseIds(v) : Array.isArray(v) ? v : [];
    return [...new Set(ids.filter((id): id is string => typeof id === "string" && GID_PRODUCT.test(id)))];
  };
  const triggerProductIds = triggerType === "products" ? toIds(raw.triggerProductIds).slice(0, 50) : [];
  const offerProductIds = toIds(raw.offerProductIds);
  const discountPercent = Math.max(0, Math.min(90, Number.parseInt(String(raw.discountPercent ?? "0"), 10) || 0));

  if (!name) errors.name = "Give the offer a name (only you see it).";
  if (!headline) errors.headline = "Add a headline shoppers will see, e.g. “Complete your order”.";
  if (triggerType === "products" && triggerProductIds.length === 0)
    errors.triggerProductIds = "Pick at least one product that triggers this offer.";
  if (offerProductIds.length === 0) errors.offerProductIds = "Pick at least one product to recommend.";
  if (offerProductIds.length > PLAN_LIMITS.growth.maxProductsPerOffer)
    errors.offerProductIds = `Recommend up to ${PLAN_LIMITS.growth.maxProductsPerOffer} products per offer.`;

  return {
    input: { name, headline, status, triggerType, triggerProductIds, offerProductIds, priority, discountPercent },
    errors,
  };
}

export async function countActiveOffers(db: Db, shop: string, excludeId?: string) {
  const offers = await listOffers(db, shop);
  return offers.filter((o) => o.status === "active" && o.id !== excludeId).length;
}

export async function saveOffer(
  db: Db,
  shop: string,
  id: string | null,
  input: OfferInput,
  products: OfferProduct[],
  now = new Date(),
): Promise<string> {
  const values = {
    name: input.name,
    status: input.status,
    triggerType: input.triggerType,
    triggerProductIds: JSON.stringify(input.triggerProductIds),
    offerProducts: JSON.stringify(products),
    headline: input.headline,
    priority: input.priority,
    discountPercent: input.discountPercent,
    updatedAt: now.toISOString(),
  };
  if (id) {
    await db.update(offerTable).set(values).where(and(eq(offerTable.shop, shop), eq(offerTable.id, id)));
    return id;
  }
  const newId = crypto.randomUUID();
  await db.insert(offerTable).values({ id: newId, shop, createdAt: now.toISOString(), ...values });
  return newId;
}

export async function deleteOffer(db: Db, shop: string, id: string) {
  await db.delete(offerTable).where(and(eq(offerTable.shop, shop), eq(offerTable.id, id)));
  await db.delete(offerStatTable).where(and(eq(offerStatTable.shop, shop), eq(offerStatTable.offerId, id)));
}

/** Shop-scoped purge for shop/redact. */
export async function purgeCartUpsellShop(db: Db, shop: string) {
  await db.delete(offerTable).where(eq(offerTable.shop, shop));
  await db.delete(offerStatTable).where(eq(offerStatTable.shop, shop));
  await db.delete(appSettingTable).where(eq(appSettingTable.shop, shop));
  await purgeAttribution(db, shop);
}

export function numericId(gid: string): number {
  return Number(gid.split("/").pop());
}

/** Storefront config stored in an app-owned metafield and read by the theme extension. */
export interface StorefrontConfig {
  v: 1;
  /** Percent of shoppers who don't see offers (always-on holdout test); 0 = off. */
  holdout: number;
  offers: Array<{
    id: string;
    headline: string;
    trigger: "all" | "products";
    triggerProductIds: number[];
    discountPercent: number;
    products: Array<{ handle: string; productId: number; variantId: number }>;
  }>;
}

export function buildStorefrontConfig(offers: Offer[], plan: PlanKey, holdout = 0): StorefrontConfig {
  const limit = PLAN_LIMITS[plan].maxActiveOffers;
  const active = offers.filter((o) => o.status === "active" && o.offerProducts.length > 0).slice(0, limit);
  return {
    v: 1,
    holdout,
    offers: active.map((o) => ({
      id: o.id,
      headline: o.headline,
      trigger: o.triggerType,
      triggerProductIds: o.triggerProductIds.map(numericId),
      discountPercent: PLAN_LIMITS[plan].discounts ? o.discountPercent : 0,
      products: o.offerProducts.slice(0, PLAN_LIMITS[plan].maxProductsPerOffer).map((p) => ({
        handle: p.handle,
        productId: numericId(p.productId),
        variantId: numericId(p.variantId),
      })),
    })),
  };
}

/** Config for the storevine-cart-discount Function (discount metafield). */
export interface DiscountFunctionConfig {
  offers: Record<string, { percent: number; message: string; productIds: string[]; triggerProductIds: string[] }>;
}

export function buildDiscountConfig(offers: Offer[], plan: PlanKey): DiscountFunctionConfig {
  const config: DiscountFunctionConfig = { offers: {} };
  if (!PLAN_LIMITS[plan].discounts) return config;
  const live = offers.filter((o) => o.status === "active").slice(0, PLAN_LIMITS[plan].maxActiveOffers);
  for (const o of live) {
    if (o.discountPercent <= 0) continue;
    config.offers[o.id] = {
      percent: o.discountPercent,
      message: `${o.discountPercent}% off`,
      productIds: o.offerProducts.map((p) => p.productId),
      triggerProductIds: o.triggerType === "products" ? o.triggerProductIds : [],
    };
  }
  return config;
}

export type StatType = "impression" | "click" | "add";

export function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export async function recordStats(
  db: Db,
  shop: string,
  events: Array<{ offerId: string; type: StatType }>,
  validOfferIds: Set<string>,
  now = new Date(),
) {
  const day = utcDay(now);
  const counts = new Map<string, { impressions: number; clicks: number; adds: number }>();
  for (const e of events) {
    if (!validOfferIds.has(e.offerId)) continue;
    const c = counts.get(e.offerId) ?? { impressions: 0, clicks: 0, adds: 0 };
    if (e.type === "impression") c.impressions++;
    else if (e.type === "click") c.clicks++;
    else if (e.type === "add") c.adds++;
    counts.set(e.offerId, c);
  }
  for (const [offerId, c] of counts) {
    await db
      .insert(offerStatTable)
      .values({ shop, offerId, day, ...c })
      .onConflictDoUpdate({
        target: [offerStatTable.shop, offerStatTable.offerId, offerStatTable.day],
        set: {
          impressions: sql`${offerStatTable.impressions} + ${c.impressions}`,
          clicks: sql`${offerStatTable.clicks} + ${c.clicks}`,
          adds: sql`${offerStatTable.adds} + ${c.adds}`,
        },
      });
  }
  return counts.size;
}

export interface OfferStats {
  impressions: number;
  clicks: number;
  adds: number;
}

export async function statsByOffer(db: Db, shop: string, days = 30, now = new Date()) {
  const since = utcDay(new Date(now.getTime() - (days - 1) * 86_400_000));
  const rows = await db
    .select({
      offerId: offerStatTable.offerId,
      impressions: sql<number>`sum(${offerStatTable.impressions})`,
      clicks: sql<number>`sum(${offerStatTable.clicks})`,
      adds: sql<number>`sum(${offerStatTable.adds})`,
    })
    .from(offerStatTable)
    .where(and(eq(offerStatTable.shop, shop), gte(offerStatTable.day, since)))
    .groupBy(offerStatTable.offerId);
  const map = new Map<string, OfferStats>();
  for (const r of rows) {
    map.set(r.offerId, { impressions: Number(r.impressions), clicks: Number(r.clicks), adds: Number(r.adds) });
  }
  return map;
}

export function totals(stats: Map<string, OfferStats>): OfferStats {
  const t = { impressions: 0, clicks: 0, adds: 0 };
  for (const s of stats.values()) {
    t.impressions += s.impressions;
    t.clicks += s.clicks;
    t.adds += s.adds;
  }
  return t;
}
