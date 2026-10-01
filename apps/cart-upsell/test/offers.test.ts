import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import type { D1Database } from "@cloudflare/workers-types";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, runMigrations, platformMigrations } from "@upwise/platform";
import { cartUpsellMigrations } from "../app/lib/schema";
import {
  buildDiscountConfig,
  buildStorefrontConfig,
  countActiveOffers,
  deleteOffer,
  listOffers,
  purgeCartUpsellShop,
  recordStats,
  saveOffer,
  statsByOffer,
  validateOfferInput,
  type OfferProduct,
} from "../app/lib/offers.server";

const proxy = await getPlatformProxy<{ DB: D1Database }>({
  configPath: join(import.meta.dirname, "../../../packages/platform/test/wrangler.test.jsonc"),
  persist: { path: mkdtempSync(join(tmpdir(), "upwise-cart-")) },
});
const d1 = proxy.env.DB;
const db = getDb(d1);
const SHOP = "a.myshopify.com";
afterAll(() => proxy.dispose());

const P = (n: number): OfferProduct => ({
  productId: `gid://shopify/Product/${n}`,
  variantId: `gid://shopify/ProductVariant/${n}0`,
  handle: `p-${n}`,
  title: `Product ${n}`,
  image: null,
});

beforeEach(async () => {
  await runMigrations(d1, [...platformMigrations, ...cartUpsellMigrations]);
  await d1.batch([d1.prepare("DELETE FROM offer"), d1.prepare("DELETE FROM offer_stat_daily")]);
});

describe("validateOfferInput", () => {
  it("requires name, headline and products", () => {
    const { errors } = validateOfferInput({});
    expect(Object.keys(errors).sort()).toEqual(["headline", "name", "offerProductIds"]);
  });
  it("treats a missing switch value as paused", () => {
    const { input } = validateOfferInput({ name: "x", headline: "y", offerProductIds: '["gid://shopify/Product/1"]' });
    expect(input.status).toBe("paused");
  });
  it("drops invalid ids, dedupes, and requires trigger products for product triggers", () => {
    const { input, errors } = validateOfferInput({
      name: "x", headline: "y", status: "active", triggerType: "products",
      offerProductIds: JSON.stringify(["gid://shopify/Product/1", "gid://shopify/Product/1", "bad", 5]),
      triggerProductIds: "[]",
    });
    expect(input.offerProductIds).toEqual(["gid://shopify/Product/1"]);
    expect(errors.triggerProductIds).toBeTruthy();
  });
  it("clamps discount to 0-90", () => {
    const base = { name: "x", headline: "y", offerProductIds: '["gid://shopify/Product/1"]' };
    expect(validateOfferInput({ ...base, discountPercent: "150" }).input.discountPercent).toBe(90);
    expect(validateOfferInput({ ...base, discountPercent: "-5" }).input.discountPercent).toBe(0);
    expect(validateOfferInput({ ...base, discountPercent: "abc" }).input.discountPercent).toBe(0);
  });
  it("caps recommended products at 3", () => {
    const ids = [1, 2, 3, 4].map((n) => `gid://shopify/Product/${n}`);
    expect(validateOfferInput({ name: "x", headline: "y", offerProductIds: JSON.stringify(ids) }).errors.offerProductIds).toBeTruthy();
  });
});

describe("offers storage and storefront config", () => {
  it("saves, lists by priority, counts active, deletes", async () => {
    const base = { name: "A", headline: "H", status: "active" as const, triggerType: "all" as const, triggerProductIds: [], offerProductIds: [], priority: 1, discountPercent: 0 };
    const a = await saveOffer(db, SHOP, null, base, [P(1)]);
    const b = await saveOffer(db, SHOP, null, { ...base, name: "B", priority: 5 }, [P(2)]);
    await saveOffer(db, SHOP, null, { ...base, name: "C", status: "paused" }, [P(3)]);
    const list = await listOffers(db, SHOP);
    expect(list.map((o) => o.name)).toEqual(["B", "A", "C"]);
    expect(await countActiveOffers(db, SHOP)).toBe(2);
    expect(await countActiveOffers(db, SHOP, b)).toBe(1);
    await deleteOffer(db, SHOP, a);
    expect((await listOffers(db, SHOP)).map((o) => o.name)).toEqual(["B", "C"]);
  });

  it("free plan exposes only the top active offer; growth exposes all", async () => {
    const base = { headline: "H", status: "active" as const, triggerType: "products" as const, triggerProductIds: ["gid://shopify/Product/9"], offerProductIds: [], priority: 0, discountPercent: 0 };
    await saveOffer(db, SHOP, null, { ...base, name: "low" }, [P(1)]);
    await saveOffer(db, SHOP, null, { ...base, name: "high", priority: 9 }, [P(2), P(3)]);
    const offers = await listOffers(db, SHOP);
    const free = buildStorefrontConfig(offers, "free");
    expect(free.offers).toHaveLength(1);
    expect(free.offers[0].products).toEqual([
      { handle: "p-2", productId: 2, variantId: 20 },
      { handle: "p-3", productId: 3, variantId: 30 },
    ]);
    expect(free.offers[0].triggerProductIds).toEqual([9]);
    expect(buildStorefrontConfig(offers, "growth").offers).toHaveLength(2);
  });

  it("discount config: only paid plans, only offers with a discount, includes trigger ids", async () => {
    const base = { headline: "H", status: "active" as const, triggerType: "products" as const, triggerProductIds: ["gid://shopify/Product/9"], offerProductIds: [], priority: 0 };
    const withDiscount = await saveOffer(db, SHOP, null, { ...base, name: "d", discountPercent: 15 }, [P(1)]);
    await saveOffer(db, SHOP, null, { ...base, name: "nod", discountPercent: 0 }, [P(2)]);
    const offers = await listOffers(db, SHOP);
    expect(buildDiscountConfig(offers, "free").offers).toEqual({});
    const growth = buildDiscountConfig(offers, "growth");
    expect(Object.keys(growth.offers)).toEqual([withDiscount]);
    expect(growth.offers[withDiscount]).toMatchObject({ percent: 15, productIds: ["gid://shopify/Product/1"], triggerProductIds: ["gid://shopify/Product/9"] });
    expect(buildStorefrontConfig(offers, "free").offers.every((o) => o.discountPercent === 0)).toBe(true);
  });

  it("records stats only for the shop's own offers and aggregates by day", async () => {
    const id = await saveOffer(db, SHOP, null, { name: "A", headline: "H", status: "active", triggerType: "all", triggerProductIds: [], offerProductIds: [], priority: 0, discountPercent: 0 }, [P(1)]);
    const valid = new Set([id]);
    await recordStats(db, SHOP, [{ offerId: id, type: "impression" }, { offerId: id, type: "add" }, { offerId: "other", type: "add" }], valid);
    await recordStats(db, SHOP, [{ offerId: id, type: "impression" }, { offerId: id, type: "click" }], valid);
    const stats = await statsByOffer(db, SHOP);
    expect(stats.get(id)).toEqual({ impressions: 2, clicks: 1, adds: 1 });
    expect(stats.has("other")).toBe(false);
  });

  it("purges all cart data for a shop", async () => {
    const id = await saveOffer(db, SHOP, null, { name: "A", headline: "H", status: "active", triggerType: "all", triggerProductIds: [], offerProductIds: [], priority: 0, discountPercent: 0 }, [P(1)]);
    await recordStats(db, SHOP, [{ offerId: id, type: "impression" }], new Set([id]));
    await purgeCartUpsellShop(db, SHOP);
    expect(await listOffers(db, SHOP)).toHaveLength(0);
    expect((await statsByOffer(db, SHOP)).size).toBe(0);
  });
});
