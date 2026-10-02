import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import type { D1Database } from "@cloudflare/workers-types";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, runMigrations, platformMigrations } from "@upwise/platform";
import { cartUpsellMigrations } from "../app/lib/schema";
import {
  attributionTotals, computeLift, getHoldoutPercent, liftReport, offerSales, parseOrder, parseRefund,
  purgeAttribution, recordCarts, recordOrder, recordRefund, setHoldoutPercent,
} from "../app/lib/attribution.server";
import { buildStorefrontConfig } from "../app/lib/offers.server";

const proxy = await getPlatformProxy<{ DB: D1Database }>({
  configPath: join(import.meta.dirname, "../../../packages/platform/test/wrangler.test.jsonc"),
  persist: { path: mkdtempSync(join(tmpdir(), "storevine-attr-")) },
});
const d1 = proxy.env.DB;
const db = getDb(d1);
const SHOP = "a.myshopify.com";
const NOW = new Date("2026-10-01T12:00:00Z");
afterAll(() => proxy.dispose());

beforeEach(async () => {
  await runMigrations(d1, [...platformMigrations, ...cartUpsellMigrations]);
  await purgeAttribution(db, SHOP);
  await d1.prepare("DELETE FROM app_setting").run();
});

const money = (amount: string) => ({ shop_money: { amount, currency_code: "USD" } });
const order = (id: number, opts: { group?: string; subtotal?: string; offerLines?: Array<[string, number, string, string?]> } = {}) => ({
  id,
  admin_graphql_api_id: `gid://shopify/Order/${id}`,
  created_at: "2026-10-01T10:00:00Z",
  currency: "USD",
  subtotal_price_set: money(opts.subtotal ?? "100.00"),
  note_attributes: opts.group ? [{ name: "_storevine_group", value: opts.group }] : [],
  line_items: [
    { quantity: 1, price_set: money("80.00"), properties: [] },
    ...(opts.offerLines ?? []).map(([offerId, qty, price, discount]) => ({
      quantity: qty,
      price_set: money(price),
      properties: [{ name: "_storevine_offer", value: offerId }],
      discount_allocations: discount ? [{ amount_set: money(discount) }] : [],
    })),
  ],
});

describe("order attribution", () => {
  it("parses offer lines net of discounts and the holdout group", () => {
    const p = parseOrder(order(1, { group: "s", offerLines: [["o1", 2, "10.00", "3.00"]] }));
    expect(p.orderId).toBe("gid://shopify/Order/1");
    expect(p.group).toBe("s");
    expect(p.totalCents).toBe(10000);
    expect(p.offers.get("o1")).toEqual({ units: 2, revenueCents: 1700, discountCents: 300 });
    expect(parseOrder(order(2, { group: "x" })).group).toBeNull();
  });

  it("records idempotently, ignores unknown offers, and nets refunds", async () => {
    const known = new Set(["o1"]);
    const p = parseOrder(order(1, { group: "s", offerLines: [["o1", 1, "20.00"], ["forged", 1, "99.00"]] }));
    expect(await recordOrder(db, SHOP, p, known)).toEqual({ lines: 1, grouped: true });
    await recordOrder(db, SHOP, p, known); // webhook retry
    expect(await attributionTotals(db, SHOP, 30, NOW)).toMatchObject({ orders: 1, netCents: 2000 });

    await recordRefund(
      db,
      SHOP,
      parseRefund({
        order_id: 1,
        refund_line_items: [
          { quantity: 1, subtotal_set: money("20.00"), line_item: { properties: [{ name: "_storevine_offer", value: "o1" }] } },
          { quantity: 1, subtotal_set: money("30.00"), line_item: { properties: [] } },
        ],
      }),
    );
    const sales = await offerSales(db, SHOP, 30, NOW);
    expect(sales.get("o1")).toMatchObject({ orders: 1, netCents: 0, refundedCents: 2000 });
    const row = await d1.prepare("SELECT total_cents, refunded_cents FROM cart_order WHERE order_id = 'gid://shopify/Order/1'").first();
    expect(row).toEqual({ total_cents: 10000, refunded_cents: 5000 });
  });

  it("never refunds more than was paid", async () => {
    await recordOrder(db, SHOP, parseOrder(order(3, { offerLines: [["o1", 1, "10.00"]] })), new Set(["o1"]));
    const r = parseRefund({ order_id: 3, refund_line_items: [{ subtotal_set: money("50.00"), line_item: { properties: [{ name: "_storevine_offer", value: "o1" }] } }] });
    await recordRefund(db, SHOP, r);
    await recordRefund(db, SHOP, r);
    expect((await offerSales(db, SHOP, 30, NOW)).get("o1")?.netCents).toBe(0);
  });
});

describe("holdout", () => {
  it("stores a valid holdout percent and passes it to the storefront", async () => {
    expect(await getHoldoutPercent(db, SHOP)).toBe(10);
    expect(await setHoldoutPercent(db, SHOP, 0)).toBe(0);
    expect(await getHoldoutPercent(db, SHOP)).toBe(0);
    expect(await setHoldoutPercent(db, SHOP, 37)).toBe(10);
    expect(buildStorefrontConfig([], "free", 20).holdout).toBe(20);
  });

  it("waits for enough data", () => {
    const g = { carts: 50, orders: 5, netCents: 50000, sumSquares: 5 * 10000 ** 2 };
    expect(computeLift(g, g).status).toBe("collecting");
  });

  it("finds a clear lift and estimates extra revenue", () => {
    // Holdout: 1000 carts, 100 orders of $100. Shown: 1000 carts, 130 orders of $100.
    const h = { carts: 1000, orders: 100, netCents: 100 * 10000, sumSquares: 100 * 10000 ** 2 };
    const s = { carts: 1000, orders: 130, netCents: 130 * 10000, sumSquares: 130 * 10000 ** 2 };
    const r = computeLift(h, s);
    if (r.status !== "ready") throw new Error("expected ready");
    expect(r.rpcHoldout).toBe(1000);
    expect(r.rpcShown).toBe(1300);
    expect(r.lift).toBeCloseTo(0.3, 5);
    expect(r.liftLow).toBeGreaterThan(0);
    expect(r.significant).toBe(true);
    expect(r.incrementalCents).toBe(300000);
  });

  it("reports no clear difference when groups are alike", () => {
    const h = { carts: 500, orders: 50, netCents: 50 * 10000, sumSquares: 50 * 10000 ** 2 };
    const s = { carts: 500, orders: 52, netCents: 52 * 10000, sumSquares: 52 * 10000 ** 2 };
    const r = computeLift(h, s);
    expect(r.status === "ready" && r.significant).toBe(false);
  });

  it("builds the report from carts and orders", async () => {
    await recordCarts(db, SHOP, { h: 25, s: 25 }, NOW);
    for (let i = 0; i < 5; i++) await recordCarts(db, SHOP, { h: 25, s: 25 }, NOW);
    for (let i = 0; i < 25; i++) {
      await recordOrder(db, SHOP, parseOrder(order(1000 + i, { group: "h", subtotal: "50.00" })), new Set());
      await recordOrder(db, SHOP, parseOrder(order(2000 + i, { group: "s", subtotal: "80.00" })), new Set());
    }
    const r = await liftReport(db, SHOP, 30, NOW);
    expect(r.status).toBe("ready");
    if (r.status !== "ready") return;
    expect(r.holdout).toMatchObject({ carts: 150, orders: 25, netCents: 125000 });
    expect(r.rpcShown).toBe(Math.round((25 * 8000) / 150));
    expect(r.liftLow).toBeLessThan(r.lift); // 25 orders a side is still a wide range
    expect(r.liftHigh).toBeGreaterThan(r.lift);
  });

  it("caps cart counts per request", async () => {
    await recordCarts(db, SHOP, { h: 1000, s: -5 }, NOW);
    const row = await d1.prepare("SELECT SUM(carts) AS n FROM holdout_stat_daily").first<{ n: number }>();
    expect(row?.n).toBe(25);
  });
});
