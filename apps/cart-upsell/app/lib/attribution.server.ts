/**
 * Order attribution and the always-on holdout test.
 *
 * Attribution: the storefront widget tags lines it adds with the hidden line
 * property `_storevine_offer`. orders/create records those lines per offer;
 * refunds/create subtracts refunded amounts, so revenue is shown net of refunds.
 *
 * Holdout: each shopper is placed in a group once ("h" = offers hidden, "s" =
 * offers shown) and the widget writes it to the hidden cart attribute
 * `_storevine_group` when the cart could show an offer. The widget counts those
 * eligible carts per group; orders/create records order value per group. The
 * lift report compares revenue per eligible cart between the groups.
 *
 * Nothing about the customer is stored: only order ids, amounts and the group.
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "@upwise/platform";
import { appSettingTable, cartOrderTable, holdoutStatTable, offerOrderTable } from "./schema";

export const OFFER_PROPERTY = "_storevine_offer";
export const GROUP_ATTRIBUTE = "_storevine_group";
export type Group = "h" | "s";
export const HOLDOUT_CHOICES = [0, 5, 10, 20] as const;
export const DEFAULT_HOLDOUT = 10;

const isGroup = (v: unknown): v is Group => v === "h" || v === "s";
const dayOf = (iso: unknown) => String(iso || new Date().toISOString()).slice(0, 10);

function cents(v: unknown): number {
  const n = Number.parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

type Money = { shop_money?: { amount?: string | number; currency_code?: string } } | null;
type Prop = { name?: string; value?: unknown };
const propValue = (props: unknown, name: string) => {
  if (!Array.isArray(props)) return undefined;
  const p = (props as Prop[]).find((x) => x && x.name === name);
  return p?.value == null ? undefined : String(p.value);
};

interface OrderLine {
  quantity?: number;
  price?: string;
  price_set?: Money;
  properties?: Prop[];
  discount_allocations?: Array<{ amount?: string; amount_set?: Money }>;
}
interface OrderPayload {
  id?: number | string;
  admin_graphql_api_id?: string;
  created_at?: string;
  currency?: string;
  subtotal_price?: string;
  subtotal_price_set?: Money;
  note_attributes?: Prop[];
  line_items?: OrderLine[];
}

const orderGid = (o: { id?: number | string; admin_graphql_api_id?: string }) =>
  o.admin_graphql_api_id || (o.id ? `gid://shopify/Order/${o.id}` : "");

export function parseOrder(payload: unknown) {
  const o = (payload ?? {}) as OrderPayload;
  const currency = o.subtotal_price_set?.shop_money?.currency_code || o.currency || "USD";
  const offers = new Map<string, { units: number; revenueCents: number; discountCents: number }>();
  for (const line of o.line_items ?? []) {
    const offerId = propValue(line.properties, OFFER_PROPERTY);
    if (!offerId) continue;
    const qty = Math.max(0, Math.floor(Number(line.quantity ?? 0)));
    const unit = cents(line.price_set?.shop_money?.amount ?? line.price);
    const discount = (line.discount_allocations ?? []).reduce((n, d) => n + cents(d.amount_set?.shop_money?.amount ?? d.amount), 0);
    const r = offers.get(offerId) ?? { units: 0, revenueCents: 0, discountCents: 0 };
    r.units += qty;
    r.revenueCents += unit * qty - discount;
    r.discountCents += discount;
    offers.set(offerId, r);
  }
  const group = propValue(o.note_attributes, GROUP_ATTRIBUTE);
  return {
    orderId: orderGid(o),
    day: dayOf(o.created_at),
    currency,
    group: isGroup(group) ? group : null,
    totalCents: cents(o.subtotal_price_set?.shop_money?.amount ?? o.subtotal_price),
    offers,
  };
}

/** Store one order. Idempotent (webhook retries insert nothing new). Unknown offer ids are ignored. */
export async function recordOrder(db: Db, shop: string, parsed: ReturnType<typeof parseOrder>, knownOffers: Set<string>) {
  if (!parsed.orderId) return { lines: 0, grouped: false };
  let lines = 0;
  for (const [offerId, r] of parsed.offers) {
    if (!knownOffers.has(offerId)) continue;
    await db
      .insert(offerOrderTable)
      .values({ shop, orderId: parsed.orderId, offerId, day: parsed.day, currency: parsed.currency, ...r })
      .onConflictDoNothing();
    lines++;
  }
  if (parsed.group) {
    await db
      .insert(cartOrderTable)
      .values({ shop, orderId: parsed.orderId, day: parsed.day, grp: parsed.group, totalCents: parsed.totalCents, currency: parsed.currency })
      .onConflictDoNothing();
  }
  return { lines, grouped: Boolean(parsed.group) };
}

interface RefundPayload {
  order_id?: number | string;
  refund_line_items?: Array<{ quantity?: number; subtotal?: string | number; subtotal_set?: Money; line_item?: { properties?: Prop[] } }>;
}

export function parseRefund(payload: unknown) {
  const r = (payload ?? {}) as RefundPayload;
  const orderId = r.order_id ? (String(r.order_id).startsWith("gid://") ? String(r.order_id) : `gid://shopify/Order/${r.order_id}`) : "";
  const byOffer = new Map<string, number>();
  let totalCents = 0;
  for (const line of r.refund_line_items ?? []) {
    const amount = cents(line.subtotal_set?.shop_money?.amount ?? line.subtotal);
    totalCents += amount;
    const offerId = propValue(line.line_item?.properties, OFFER_PROPERTY);
    if (offerId) byOffer.set(offerId, (byOffer.get(offerId) ?? 0) + amount);
  }
  return { orderId, byOffer, totalCents };
}

/** Apply a refund to orders we track. Call once per refund (guard with claimWebhook). */
export async function recordRefund(db: Db, shop: string, parsed: ReturnType<typeof parseRefund>) {
  if (!parsed.orderId || parsed.totalCents <= 0) return;
  for (const [offerId, amount] of parsed.byOffer) {
    await db
      .update(offerOrderTable)
      .set({ refundedCents: sql`min(${offerOrderTable.revenueCents}, ${offerOrderTable.refundedCents} + ${amount})` })
      .where(and(eq(offerOrderTable.shop, shop), eq(offerOrderTable.orderId, parsed.orderId), eq(offerOrderTable.offerId, offerId)));
  }
  await db
    .update(cartOrderTable)
    .set({ refundedCents: sql`min(${cartOrderTable.totalCents}, ${cartOrderTable.refundedCents} + ${parsed.totalCents})` })
    .where(and(eq(cartOrderTable.shop, shop), eq(cartOrderTable.orderId, parsed.orderId)));
}

const since = (days: number, now: Date) => new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);

export interface OfferSales { orders: number; units: number; netCents: number; refundedCents: number; currency: string }

/** Per-offer attributed sales over the last `days` days, net of refunds. */
export async function offerSales(db: Db, shop: string, days = 30, now = new Date()) {
  const rows = await db
    .select({
      offerId: offerOrderTable.offerId,
      orders: sql<number>`count(*)`,
      units: sql<number>`sum(${offerOrderTable.units})`,
      revenue: sql<number>`sum(${offerOrderTable.revenueCents})`,
      refunded: sql<number>`sum(${offerOrderTable.refundedCents})`,
      currency: sql<string>`max(${offerOrderTable.currency})`,
    })
    .from(offerOrderTable)
    .where(and(eq(offerOrderTable.shop, shop), gte(offerOrderTable.day, since(days, now))))
    .groupBy(offerOrderTable.offerId);
  const out = new Map<string, OfferSales>();
  for (const r of rows) {
    out.set(r.offerId, {
      orders: Number(r.orders),
      units: Number(r.units),
      netCents: Number(r.revenue) - Number(r.refunded),
      refundedCents: Number(r.refunded),
      currency: r.currency || "USD",
    });
  }
  return out;
}

/** Orders with at least one offer line, and their net offer revenue, over the window. */
export async function attributionTotals(db: Db, shop: string, days = 30, now = new Date()) {
  const [row] = await db
    .select({
      orders: sql<number>`count(distinct ${offerOrderTable.orderId})`,
      revenue: sql<number>`coalesce(sum(${offerOrderTable.revenueCents}), 0)`,
      refunded: sql<number>`coalesce(sum(${offerOrderTable.refundedCents}), 0)`,
      currency: sql<string>`max(${offerOrderTable.currency})`,
    })
    .from(offerOrderTable)
    .where(and(eq(offerOrderTable.shop, shop), gte(offerOrderTable.day, since(days, now))));
  return {
    orders: Number(row?.orders ?? 0),
    netCents: Number(row?.revenue ?? 0) - Number(row?.refunded ?? 0),
    refundedCents: Number(row?.refunded ?? 0),
    currency: row?.currency || "USD",
  };
}

/* ---------- holdout ---------- */

export async function getHoldoutPercent(db: Db, shop: string): Promise<number> {
  const [row] = await db
    .select({ value: appSettingTable.value })
    .from(appSettingTable)
    .where(and(eq(appSettingTable.shop, shop), eq(appSettingTable.key, "holdout")));
  if (!row) return DEFAULT_HOLDOUT;
  const n = Number(row.value);
  return (HOLDOUT_CHOICES as readonly number[]).includes(n) ? n : DEFAULT_HOLDOUT;
}

export async function setHoldoutPercent(db: Db, shop: string, percent: number) {
  const value = (HOLDOUT_CHOICES as readonly number[]).includes(percent) ? percent : DEFAULT_HOLDOUT;
  await db
    .insert(appSettingTable)
    .values({ shop, key: "holdout", value: String(value) })
    .onConflictDoUpdate({ target: [appSettingTable.shop, appSettingTable.key], set: { value: String(value) } });
  return value;
}

/** Count eligible carts per group (from storefront events). */
export async function recordCarts(db: Db, shop: string, counts: { h: number; s: number }, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  for (const grp of ["h", "s"] as const) {
    const n = Math.max(0, Math.min(25, Math.floor(counts[grp])));
    if (!n) continue;
    await db
      .insert(holdoutStatTable)
      .values({ shop, day, grp, carts: n })
      .onConflictDoUpdate({
        target: [holdoutStatTable.shop, holdoutStatTable.day, holdoutStatTable.grp],
        set: { carts: sql`${holdoutStatTable.carts} + ${n}` },
      });
  }
}

export interface GroupStats { carts: number; orders: number; netCents: number; sumSquares: number }

/** Below these there's too little data to say anything. */
export const MIN_ORDERS_PER_GROUP = 20;
export const MIN_CARTS_PER_GROUP = 100;

export type LiftResult =
  | { status: "off" }
  | { status: "collecting"; holdout: GroupStats; shown: GroupStats; currency: string }
  | {
      status: "ready";
      holdout: GroupStats;
      shown: GroupStats;
      currency: string;
      /** Revenue per eligible cart, in cents. */
      rpcHoldout: number;
      rpcShown: number;
      /** Relative lift and its 95% interval, as fractions (0.05 = +5%). */
      lift: number;
      liftLow: number;
      liftHigh: number;
      /** Estimated extra revenue from showing offers, in cents (shown carts × difference per cart). */
      incrementalCents: number;
      significant: boolean;
    };

/**
 * Compare revenue per eligible cart (non-buying carts count as 0) between the
 * groups, with a normal-approximation 95% interval on the difference.
 */
export function computeLift(holdout: GroupStats, shown: GroupStats, currency = "USD"): LiftResult {
  if (
    holdout.orders < MIN_ORDERS_PER_GROUP ||
    shown.orders < MIN_ORDERS_PER_GROUP ||
    holdout.carts < MIN_CARTS_PER_GROUP ||
    shown.carts < MIN_CARTS_PER_GROUP
  ) {
    return { status: "collecting", holdout, shown, currency };
  }
  const stats = (g: GroupStats) => {
    // Orders can arrive for carts counted before the window; never let orders exceed carts.
    const n = Math.max(g.carts, g.orders);
    const mean = g.netCents / n;
    const variance = Math.max(0, g.sumSquares / n - mean * mean);
    return { n, mean, se2: variance / n };
  };
  const h = stats(holdout);
  const s = stats(shown);
  const diff = s.mean - h.mean;
  const se = Math.sqrt(h.se2 + s.se2);
  const low = diff - 1.96 * se;
  const high = diff + 1.96 * se;
  const base = h.mean || 1;
  return {
    status: "ready",
    holdout,
    shown,
    currency,
    rpcHoldout: Math.round(h.mean),
    rpcShown: Math.round(s.mean),
    lift: diff / base,
    liftLow: low / base,
    liftHigh: high / base,
    incrementalCents: Math.round(diff * s.n),
    significant: low > 0 || high < 0,
  };
}

export async function liftReport(db: Db, shop: string, days = 30, now = new Date()): Promise<LiftResult> {
  const from = since(days, now);
  const carts = await db
    .select({ grp: holdoutStatTable.grp, carts: sql<number>`sum(${holdoutStatTable.carts})` })
    .from(holdoutStatTable)
    .where(and(eq(holdoutStatTable.shop, shop), gte(holdoutStatTable.day, from)))
    .groupBy(holdoutStatTable.grp);
  const orders = await db
    .select({
      grp: cartOrderTable.grp,
      orders: sql<number>`count(*)`,
      net: sql<number>`sum(${cartOrderTable.totalCents} - ${cartOrderTable.refundedCents})`,
      sq: sql<number>`sum(cast(${cartOrderTable.totalCents} - ${cartOrderTable.refundedCents} as real) * (${cartOrderTable.totalCents} - ${cartOrderTable.refundedCents}))`,
      currency: sql<string>`max(${cartOrderTable.currency})`,
    })
    .from(cartOrderTable)
    .where(and(eq(cartOrderTable.shop, shop), gte(cartOrderTable.day, from), inArray(cartOrderTable.grp, ["h", "s"])))
    .groupBy(cartOrderTable.grp);
  const empty = (): GroupStats => ({ carts: 0, orders: 0, netCents: 0, sumSquares: 0 });
  const g = { h: empty(), s: empty() };
  let currency = "USD";
  for (const c of carts) if (isGroup(c.grp)) g[c.grp].carts = Number(c.carts);
  for (const o of orders) {
    if (!isGroup(o.grp)) continue;
    g[o.grp].orders = Number(o.orders);
    g[o.grp].netCents = Number(o.net);
    g[o.grp].sumSquares = Number(o.sq);
    currency = o.currency || currency;
  }
  return computeLift(g.h, g.s, currency);
}

export async function purgeAttribution(db: Db, shop: string) {
  await db.delete(offerOrderTable).where(eq(offerOrderTable.shop, shop));
  await db.delete(cartOrderTable).where(eq(cartOrderTable.shop, shop));
  await db.delete(holdoutStatTable).where(eq(holdoutStatTable.shop, shop));
}
