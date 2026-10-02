import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import type { D1Database } from "@cloudflare/workers-types";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, platformMigrations, runMigrations } from "@upwise/platform";
import { appMigrations } from "../app/lib/schema";
import {
  bundleSales, bundleStats, countActive, deleteBundle, discountConfig, listBundles, parseBundleOrder, parseTiers, purgeBundlesShop,
  recordBundleEvents, recordBundleOrder, saveBundle, storefrontConfig, validateBundleInput, type BundleProduct,
} from "../app/lib/bundles.server";

const fnPath = "../extensions/storevine-bundle-discount/src/cart_lines_discounts_generate_run.js";
const { cartLinesDiscountsGenerateRun: run } = (await import(fnPath)) as { cartLinesDiscountsGenerateRun: (i: unknown) => { operations: any[] } };

const proxy = await getPlatformProxy<{ DB: D1Database }>({
  configPath: join(import.meta.dirname, "../../../packages/platform/test/wrangler.test.jsonc"),
  persist: { path: mkdtempSync(join(tmpdir(), "storevine-bundles-")) },
});
const d1 = proxy.env.DB;
const db = getDb(d1);
const SHOP = "a.myshopify.com";
afterAll(() => proxy.dispose());
beforeEach(async () => {
  await runMigrations(d1, [...platformMigrations, ...appMigrations]);
  await d1.batch([d1.prepare("DELETE FROM bundle"), d1.prepare("DELETE FROM bundle_stat_daily"), d1.prepare("DELETE FROM bundle_order")]);
});

const gid = (n: number) => `gid://shopify/Product/${n}`;
const P = (n: number): BundleProduct => ({ productId: gid(n), variantId: `gid://shopify/ProductVariant/${n}0`, handle: `p${n}`, title: `P${n}`, image: null });

describe("validateBundleInput", () => {
  it("needs a name and 2-5 products; clamps discount", () => {
    expect(Object.keys(validateBundleInput({}).errors).sort()).toEqual(["name", "productIds"]);
    const six = JSON.stringify([1, 2, 3, 4, 5, 6].map(gid));
    expect(validateBundleInput({ name: "x", productIds: six }).errors.productIds).toMatch(/up to 5/);
    const ok = validateBundleInput({ name: "x", status: "active", productIds: JSON.stringify([gid(1), gid(2), gid(2), "bad"]), discountPercent: "150" });
    expect(ok.errors).toEqual({});
    expect(ok.input).toMatchObject({ productIds: [gid(1), gid(2)], discountPercent: 90, status: "active" });
  });
});

describe("volume bundles (quantity breaks, mix and match)", () => {
  it("validates tiers: 1-4 levels, increasing quantity, non-decreasing discount", () => {
    expect(parseTiers('[{"min":2,"percent":10},{"min":3,"percent":15}]')).toEqual({ tiers: [{ min: 2, percent: 10 }, { min: 3, percent: 15 }] });
    expect(parseTiers("[]").error).toBeTruthy();
    expect(parseTiers('[{"min":1,"percent":10}]').error).toMatch(/between 2 and 100/);
    expect(parseTiers('[{"min":3,"percent":10},{"min":2,"percent":15}]').error).toMatch(/higher quantity/);
    expect(parseTiers('[{"min":2,"percent":20},{"min":3,"percent":10}]').error).toMatch(/smaller discount/);
    expect(parseTiers('[{"min":2,"percent":95}]').error).toMatch(/90%/);
    expect(parseTiers(JSON.stringify([2, 3, 4, 5, 6].map((m) => ({ min: m, percent: m })))).error).toMatch(/up to 4/);
  });
  it("allows a single product (quantity breaks) and up to 20 (mix and match)", () => {
    const tiers = JSON.stringify([{ min: 2, percent: 10 }]);
    const one = validateBundleInput({ name: "q", type: "volume", productIds: JSON.stringify([gid(1)]), tiers });
    expect(one.errors).toEqual({});
    expect(one.input).toMatchObject({ type: "volume", discountPercent: 0, title: "Buy more, save more" });
    const many = validateBundleInput({ name: "m", type: "volume", productIds: JSON.stringify(Array.from({ length: 21 }, (_, i) => gid(i + 1))), tiers });
    expect(many.errors.productIds).toMatch(/up to 20/);
    expect(validateBundleInput({ name: "f", type: "fixed", productIds: JSON.stringify([gid(1)]) }).errors.productIds).toMatch(/at least 2/);
  });
  it("is stored, exposed to the storefront and sent to the Function", async () => {
    const id = await saveBundle(db, SHOP, null, { name: "q", title: "Buy more", status: "active", type: "volume", productIds: [], discountPercent: 0, tiers: [{ min: 2, percent: 10 }] }, [P(7)]);
    const all = await listBundles(db, SHOP);
    expect(all[0]).toMatchObject({ type: "volume", tiers: [{ min: 2, percent: 10 }] });
    expect(storefrontConfig(all, "free").bundles[0]).toMatchObject({ id, type: "volume", tiers: [{ min: 2, percent: 10 }] });
    expect(discountConfig(all, "free")).toEqual({ bundles: [], volume: [{ id, message: "Buy more", tiers: [{ min: 2, percent: 10 }], productIds: [gid(7)] }] });
  });
});

describe("bundle sales report", () => {
  const BID = "11111111-2222-3333-4444-555555555555";
  const order = {
    id: 9001,
    admin_graphql_api_id: "gid://shopify/Order/9001",
    created_at: "2026-10-01T10:00:00-07:00",
    currency: "USD",
    line_items: [
      { quantity: 1, price_set: { shop_money: { amount: "600.00", currency_code: "USD" } }, properties: [{ name: "_storevine_bundle", value: BID }], discount_allocations: [{ amount_set: { shop_money: { amount: "60.00" } } }] },
      { quantity: 2, price: "24.95", properties: [{ name: "_storevine_bundle", value: BID }], discount_allocations: [] },
      { quantity: 1, price: "10.00", properties: [] },
      { quantity: 1, price: "5.00", properties: [{ name: "_storevine_bundle", value: "not-a-uuid" }] },
    ],
  };
  it("sums bundle lines after discounts and ignores other lines", () => {
    const parsed = parseBundleOrder(order);
    expect(parsed.orderId).toBe("gid://shopify/Order/9001");
    expect(parsed.day).toBe("2026-10-01");
    expect(parsed.rows.get(BID)).toEqual({ units: 3, revenueCents: 60000 - 6000 + 4990, discountCents: 6000, currency: "USD" });
    expect(parsed.rows.size).toBe(1);
  });
  it("records once per order and reports per bundle; unknown bundles are ignored", async () => {
    const parsed = parseBundleOrder(order);
    expect(await recordBundleOrder(db, SHOP, parsed, new Set())).toBe(0);
    await recordBundleOrder(db, SHOP, parsed, new Set([BID]));
    await recordBundleOrder(db, SHOP, parsed, new Set([BID])); // webhook retry
    const sales = await bundleSales(db, SHOP, 30, new Date("2026-10-05T00:00:00Z"));
    expect(sales.get(BID)).toEqual({ orders: 1, units: 3, revenueCents: 58990, discountCents: 6000, currency: "USD" });
    expect((await bundleSales(db, SHOP, 1, new Date("2026-10-30T00:00:00Z"))).size).toBe(0);
  });
});

describe("bundles storage and configs", () => {
  it("free plan exposes one active bundle; discount config only includes discounted bundles", async () => {
    const base = { title: "FBT", status: "active" as const, productIds: [], type: "fixed" as const, tiers: [] };
    const a = await saveBundle(db, SHOP, null, { ...base, name: "a", discountPercent: 10 }, [P(1), P(2)]);
    await saveBundle(db, SHOP, null, { ...base, name: "b", discountPercent: 0 }, [P(3), P(4)]);
    await saveBundle(db, SHOP, null, { ...base, name: "c", status: "paused", discountPercent: 20 }, [P(5), P(6)]);
    const all = await listBundles(db, SHOP);
    expect(await countActive(db, SHOP)).toBe(2);
    expect(storefrontConfig(all, "free").bundles).toHaveLength(1);
    expect(storefrontConfig(all, "growth").bundles).toHaveLength(2);
    expect(storefrontConfig(all, "free").bundles[0].products[0]).toEqual({ handle: "p1", productId: 1, variantId: 10 });
    expect(discountConfig(all, "growth").bundles.map((b) => b.id)).toEqual([a]);
    await recordBundleEvents(db, SHOP, [{ bundleId: a, type: "impression" }, { bundleId: a, type: "add" }, { bundleId: "x", type: "add" }], new Set([a]));
    expect((await bundleStats(db, SHOP)).get(a)).toEqual({ impressions: 1, adds: 1 });
    await deleteBundle(db, SHOP, a);
    expect(await listBundles(db, SHOP)).toHaveLength(2);
    await purgeBundlesShop(db, SHOP);
    expect(await listBundles(db, SHOP)).toHaveLength(0);
  });
});

describe("storevine-bundle-discount function", () => {
  const line = (id: string, n: number, quantity = 1) => ({ id, quantity, merchandise: { __typename: "ProductVariant", product: { id: gid(n) } } });
  const input = (lines: unknown[], bundles: unknown[]) => ({ cart: { lines }, discount: { discountClasses: ["PRODUCT"], metafield: { jsonValue: { bundles } } } });
  const B = { id: "b1", percent: 10, message: "Bundle 10% off", productIds: [gid(1), gid(2)] };

  it("discounts one unit of each product when the full bundle is in the cart", () => {
    const out = run(input([line("l1", 1), line("l2", 2), line("l3", 3)], [B]));
    expect(out.operations[0].productDiscountsAdd.candidates).toEqual([
      { message: "Bundle 10% off", targets: [{ cartLine: { id: "l1", quantity: 1 } }, { cartLine: { id: "l2", quantity: 1 } }], value: { percentage: { value: 10 } } },
    ]);
  });
  it("uses the number of complete sets as the quantity", () => {
    const out = run(input([line("l1", 1, 3), line("l2", 2, 2)], [B]));
    expect(out.operations[0].productDiscountsAdd.candidates[0].targets).toEqual([
      { cartLine: { id: "l1", quantity: 2 } }, { cartLine: { id: "l2", quantity: 2 } },
    ]);
  });
  it("does nothing when a bundle product is missing", () => {
    expect(run(input([line("l1", 1)], [B])).operations).toEqual([]);
  });
  it("never discounts the same unit for two bundles", () => {
    const B2 = { ...B, id: "b2", productIds: [gid(1), gid(3)] };
    const out = run(input([line("l1", 1), line("l2", 2), line("l3", 3)], [B, B2]));
    expect(out.operations[0].productDiscountsAdd.candidates).toHaveLength(1); // only b1; product 1's single unit is used
  });
  it("ignores invalid config and missing PRODUCT class", () => {
    expect(run(input([line("l1", 1), line("l2", 2)], [{ ...B, percent: 0 }])).operations).toEqual([]);
    expect(run({ cart: { lines: [line("l1", 1), line("l2", 2)] }, discount: { discountClasses: [], metafield: { jsonValue: { bundles: [B] } } } }).operations).toEqual([]);
  });

  const vinput = (lines: unknown[], volume: unknown[], bundles: unknown[] = []) => ({ cart: { lines }, discount: { discountClasses: ["PRODUCT"], metafield: { jsonValue: { bundles, volume } } } });
  const V = { id: "v1", message: "Buy more", tiers: [{ min: 2, percent: 10 }, { min: 3, percent: 15 }], productIds: [gid(1)] };

  it("quantity breaks: applies the best tier reached to all units", () => {
    expect(run(vinput([line("l1", 1, 1)], [V])).operations).toEqual([]);
    const two = run(vinput([line("l1", 1, 2)], [V])).operations[0].productDiscountsAdd.candidates[0];
    expect(two).toEqual({ message: "Buy more: buy 2+, save 10%", targets: [{ cartLine: { id: "l1", quantity: 2 } }], value: { percentage: { value: 10 } } });
    const four = run(vinput([line("l1", 1, 3), line("l1b", 1, 1)], [V])).operations[0].productDiscountsAdd.candidates[0];
    expect(four.value.percentage.value).toBe(15);
    expect(four.targets).toEqual([{ cartLine: { id: "l1", quantity: 3 } }, { cartLine: { id: "l1b", quantity: 1 } }]);
  });
  it("mix and match: counts units across the bundle's products", () => {
    const M = { ...V, id: "m1", productIds: [gid(1), gid(2), gid(3)] };
    const out = run(vinput([line("l1", 1), line("l2", 2), line("l9", 9)], [M])).operations[0].productDiscountsAdd.candidates[0];
    expect(out.value.percentage.value).toBe(10);
    expect(out.targets).toEqual([{ cartLine: { id: "l1", quantity: 1 } }, { cartLine: { id: "l2", quantity: 1 } }]);
  });
  it("bought-together units are not discounted again by a volume bundle", () => {
    const out = run(vinput([line("l1", 1, 2), line("l2", 2, 1)], [V], [B])).operations[0].productDiscountsAdd.candidates;
    expect(out).toHaveLength(1); // b1 uses one unit of product 1; the one left doesn't reach the 2-unit tier
    expect(out[0].message).toBe("Bundle 10% off");
  });
  it("ignores invalid tiers", () => {
    expect(run(vinput([line("l1", 1, 5)], [{ ...V, tiers: [{ min: 1, percent: 10 }, { min: 2, percent: 0 }] }])).operations).toEqual([]);
  });
});

