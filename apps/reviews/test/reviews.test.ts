import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import type { D1Database } from "@cloudflare/workers-types";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, platformMigrations, runMigrations } from "@upwise/platform";
import { appMigrations } from "../app/lib/schema";
import {
  createReview, deleteReview, getSettings, listReviews, parseReviewCsv, productSummary,
  publishedForProduct, purgeReviewsShop, saveSettings, setStatus, shopTotals, validateSubmission,
} from "../app/lib/reviews.server";

const proxy = await getPlatformProxy<{ DB: D1Database }>({
  configPath: join(import.meta.dirname, "../../../packages/platform/test/wrangler.test.jsonc"),
  persist: { path: mkdtempSync(join(tmpdir(), "storevine-reviews-")) },
});
const d1 = proxy.env.DB;
const db = getDb(d1);
const SHOP = "a.myshopify.com";
const P1 = "gid://shopify/Product/1";
afterAll(() => proxy.dispose());

beforeEach(async () => {
  await runMigrations(d1, [...platformMigrations, ...appMigrations]);
  await d1.batch([d1.prepare("DELETE FROM review"), d1.prepare("DELETE FROM app_setting")]);
});

const base = { productId: P1, title: "", body: "Great", author: "Ann" };

describe("validateSubmission", () => {
  const ok = { productId: "1", rating: "5", author: "Ann", body: "Lovely", startedAt: String(Date.now() - 10_000) };
  it("accepts a valid submission and builds the product gid", () => {
    expect(validateSubmission(ok).input).toMatchObject({ productId: P1, rating: 5, author: "Ann" });
  });
  it("treats a missing or stale timestamp as spam", () => {
    expect(validateSubmission({ ...ok, startedAt: undefined }).error).toBe("spam");
    expect(validateSubmission({ ...ok, startedAt: String(Date.now() - 2 * 86_400_000) }).error).toBe("spam");
  });
  it("flags honeypot and too-fast submissions as spam", () => {
    expect(validateSubmission({ ...ok, website: "x" }).error).toBe("spam");
    expect(validateSubmission({ ...ok, startedAt: String(Date.now()) }).error).toBe("spam");
  });
  it("rejects bad rating, missing name/body, bad product", () => {
    expect(validateSubmission({ ...ok, rating: "6" }).error).toBeTruthy();
    expect(validateSubmission({ ...ok, author: "" }).error).toBeTruthy();
    expect(validateSubmission({ ...ok, body: "" }).error).toBeTruthy();
    expect(validateSubmission({ ...ok, productId: "gid://x" }).error).toBeTruthy();
  });
  it("strips control characters and trims length", () => {
    const r = validateSubmission({ ...ok, body: "a\u0000b".padEnd(3000, "c") }).input!;
    expect(r.body.startsWith("ab")).toBe(true);
    expect(r.body.length).toBe(2000);
  });
});

describe("reviews storage", () => {
  it("summaries count only published reviews", async () => {
    await createReview(db, SHOP, { ...base, rating: 5, status: "published" });
    await createReview(db, SHOP, { ...base, rating: 4, status: "published" });
    const pending = await createReview(db, SHOP, { ...base, rating: 1, status: "pending" });
    let s = await productSummary(db, SHOP, P1);
    expect(s).toMatchObject({ count: 2, average: 4.5 });
    expect(s.distribution).toMatchObject({ 5: 1, 4: 1, 1: 0 });
    expect(await setStatus(db, SHOP, pending, "published")).toBe(P1);
    s = await productSummary(db, SHOP, P1);
    expect(s.count).toBe(3);
    expect((await publishedForProduct(db, SHOP, P1)).length).toBe(3);
    expect(await shopTotals(db, SHOP)).toMatchObject({ total: 3, published: 3, pending: 0 });
  });
  it("lists by status, deletes, purges, and isolates shops", async () => {
    const a = await createReview(db, SHOP, { ...base, rating: 3, status: "hidden" });
    await createReview(db, "b.myshopify.com", { ...base, rating: 3, status: "published" });
    expect((await listReviews(db, SHOP, { status: "hidden" })).map((r) => r.id)).toEqual([a]);
    expect(await deleteReview(db, SHOP, a)).toMatchObject({ productId: P1 });
    await createReview(db, SHOP, { ...base, rating: 3, status: "published" });
    await purgeReviewsShop(db, SHOP);
    expect(await listReviews(db, SHOP)).toHaveLength(0);
    expect(await listReviews(db, "b.myshopify.com")).toHaveLength(1);
  });
  it("settings default to hold-for-approval and persist", async () => {
    expect(await getSettings(db, SHOP)).toEqual({ autoPublish: false, requestsEnabled: false, requestDelayDays: 7 });
    await saveSettings(db, SHOP, { autoPublish: true, requestsEnabled: true, requestDelayDays: 3 });
    expect(await getSettings(db, SHOP)).toEqual({ autoPublish: true, requestsEnabled: true, requestDelayDays: 3 });
  });
});

describe("import counter", () => {
  it("accumulates per month and isn't reset by deleting reviews", async () => {
    const { addImported, importedThisMonth } = await import("../app/lib/reviews.server");
    await addImported(db, SHOP, 60);
    await addImported(db, SHOP, 40);
    expect(await importedThisMonth(db, SHOP)).toBe(100);
    expect(await importedThisMonth(db, SHOP, new Date(Date.UTC(2030, 0, 15)))).toBe(0);
  });
});

describe("parseReviewCsv", () => {
  it("parses quoted fields with commas, quotes and newlines", () => {
    const csv = 'product_handle,rating,title,body,author\nboard,5,"Great, really","Said ""wow""\nsecond line",Ann\n';
    const { rows, errors } = parseReviewCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ product_handle: "board", rating: "5", title: "Great, really", body: 'Said "wow"\nsecond line' });
  });
  it("reports missing columns and bad ratings", () => {
    expect(parseReviewCsv("handle,rating\nx,5").errors[0]).toMatch(/Missing columns/);
    expect(parseReviewCsv("product_handle,rating,body,author\nx,9,b,a").errors[0]).toMatch(/rating must be 1-5/);
  });
});
