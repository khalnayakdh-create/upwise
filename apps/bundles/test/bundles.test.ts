import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import type { D1Database } from "@cloudflare/workers-types";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, platformMigrations, runMigrations } from "@upwise/platform";
import { appMigrations } from "../app/lib/schema";
import {
  bundleStats, countActive, deleteBundle, discountConfig, listBundles, purgeBundlesShop,
  recordBundleEvents, saveBundle, storefrontConfig, validateBundleInput, type BundleProduct,
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
  await d1.batch([d1.prepare("DELETE FROM bundle"), d1.prepare("DELETE FROM bundle_stat_daily")]);
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

describe("bundles storage and configs", () => {
  it("free plan exposes one active bundle; discount config only includes discounted bundles", async () => {
    const base = { title: "FBT", status: "active" as const, productIds: [] };
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
});
