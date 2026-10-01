import { and, asc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@upwise/platform";
import { appSettingTable, bundleStatTable, bundleTable } from "./schema";
import { PLAN_LIMITS, type PlanKey } from "./plans";

export interface BundleProduct {
  productId: string;
  variantId: string;
  handle: string;
  title: string;
  image: string | null;
}

export interface Bundle {
  id: string;
  shop: string;
  name: string;
  title: string;
  status: "active" | "paused";
  products: BundleProduct[];
  discountPercent: number;
  createdAt: string;
  updatedAt: string;
}

export interface BundleInput {
  name: string;
  title: string;
  status: "active" | "paused";
  productIds: string[];
  discountPercent: number;
}

const GID = /^gid:\/\/shopify\/Product\/\d+$/;

function toBundle(row: typeof bundleTable.$inferSelect): Bundle {
  let products: BundleProduct[] = [];
  try {
    products = JSON.parse(row.products);
  } catch {
    products = [];
  }
  return { ...row, products: Array.isArray(products) ? products : [] };
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
  const input: BundleInput = {
    name: String(raw.name ?? "").trim().slice(0, 80),
    title: String(raw.title ?? "").trim().slice(0, 80) || "Frequently bought together",
    status: raw.status === "active" ? "active" : "paused",
    productIds: ids,
    discountPercent: Math.max(0, Math.min(90, Number.parseInt(String(raw.discountPercent ?? "0"), 10) || 0)),
  };
  if (!input.name) errors.name = "Give the bundle a name (only you see it).";
  if (ids.length < 2) errors.productIds = "Pick at least 2 products.";
  if (ids.length > 5) errors.productIds = "A bundle can have up to 5 products.";
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
}

export async function countActive(db: Db, shop: string, excludeId?: string) {
  return (await listBundles(db, shop)).filter((b) => b.status === "active" && b.id !== excludeId).length;
}

export async function purgeBundlesShop(db: Db, shop: string) {
  await db.delete(bundleTable).where(eq(bundleTable.shop, shop));
  await db.delete(bundleStatTable).where(eq(bundleStatTable.shop, shop));
  await db.delete(appSettingTable).where(eq(appSettingTable.shop, shop));
}

const num = (gid: string) => Number(gid.split("/").pop());

export function liveBundles(bundles: Bundle[], plan: PlanKey) {
  return bundles.filter((b) => b.status === "active" && b.products.length >= 2).slice(0, PLAN_LIMITS[plan].maxActiveBundles);
}

/** Storefront config (app-data metafield) read by the theme block. */
export function storefrontConfig(bundles: Bundle[], plan: PlanKey) {
  return {
    v: 1,
    bundles: liveBundles(bundles, plan).map((b) => ({
      id: b.id,
      title: b.title,
      discountPercent: b.discountPercent,
      products: b.products.map((p) => ({ handle: p.handle, productId: num(p.productId), variantId: num(p.variantId) })),
    })),
  };
}

/** Discount Function config (discount metafield). */
export function discountConfig(bundles: Bundle[], plan: PlanKey) {
  return {
    bundles: liveBundles(bundles, plan)
      .filter((b) => b.discountPercent > 0)
      .map((b) => ({ id: b.id, percent: b.discountPercent, message: `${b.title}: ${b.discountPercent}% off`, productIds: b.products.map((p) => p.productId) })),
  };
}

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
