import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import type { D1Database } from "@cloudflare/workers-types";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, platformMigrations, runMigrations } from "@upwise/platform";
import { appMigrations } from "../app/lib/schema";
import {
  buildRequestEmail, emailHash, exportCustomerRequests, isUnsubscribed, parseOrder, processDueRequests,
  recentRequests, redactCustomerRequests, scheduleRequest, signToken, unsubscribe, verifyToken, type SendDeps,
} from "../app/lib/requests.server";
import { createReview, exportCsv, reviewedFromRequest, validateRequestReview } from "../app/lib/reviews.server";
import { signUploadToken, sniffImage, verifyUploadToken, parsePhotos } from "../app/lib/photos.server";
import { reviewSignals } from "../app/lib/health-signals";
import { markRequest } from "../app/lib/requests.server";

const proxy = await getPlatformProxy<{ DB: D1Database }>({
  configPath: join(import.meta.dirname, "../../../packages/platform/test/wrangler.test.jsonc"),
  persist: { path: mkdtempSync(join(tmpdir(), "storevine-requests-")) },
});
const d1 = proxy.env.DB;
const db = getDb(d1);
const SHOP = "a.myshopify.com";
const SECRET = "test-secret";
afterAll(() => proxy.dispose());

beforeEach(async () => {
  await runMigrations(d1, [...platformMigrations, ...appMigrations]);
  await d1.batch([
    d1.prepare("DELETE FROM review"),
    d1.prepare("DELETE FROM review_request"),
    d1.prepare("DELETE FROM review_unsubscribe"),
  ]);
});

const orderPayload = {
  id: 1001,
  admin_graphql_api_id: "gid://shopify/Order/1001",
  name: "#1001",
  email: "Ann@Example.com",
  customer: { first_name: "Ann" },
  line_items: [{ product_id: 11 }, { product_id: 12 }, { product_id: 11 }, { product_id: null }],
};

describe("parseOrder", () => {
  it("extracts email, name and unique products", () => {
    expect(parseOrder(orderPayload)).toEqual({
      orderId: "gid://shopify/Order/1001",
      orderName: "#1001",
      email: "ann@example.com",
      firstName: "Ann",
      productIds: ["gid://shopify/Product/11", "gid://shopify/Product/12"],
    });
  });
  it("skips cancelled orders, missing email and orders without products", () => {
    expect(parseOrder({ ...orderPayload, cancelled_at: "2026-10-01" })).toBeNull();
    expect(parseOrder({ ...orderPayload, email: null, contact_email: null })).toBeNull();
    expect(parseOrder({ ...orderPayload, email: "not-an-email" })).toBeNull();
    expect(parseOrder({ ...orderPayload, line_items: [] })).toBeNull();
  });
  it("caps products per email at 5", () => {
    const many = { ...orderPayload, line_items: Array.from({ length: 9 }, (_, i) => ({ product_id: i + 1 })) };
    expect(parseOrder(many)!.productIds).toHaveLength(5);
  });
});

describe("tokens", () => {
  it("round-trips and is purpose-bound", async () => {
    const t = await signToken(SECRET, "review", { shop: SHOP, requestId: "r1" });
    expect(await verifyToken(SECRET, "review", t)).toEqual({ shop: SHOP, requestId: "r1" });
    expect(await verifyToken(SECRET, "unsub", t)).toBeNull();
  });
  it("rejects tampering and other secrets", async () => {
    const t = await signToken(SECRET, "review", { shop: SHOP, requestId: "r1" });
    const [body, sig] = t.split(".");
    const forged = btoa(JSON.stringify({ p: "review", s: "evil.myshopify.com", r: "r1" })).replace(/=+$/, "");
    expect(await verifyToken(SECRET, "review", `${forged}.${sig}`)).toBeNull();
    expect(await verifyToken("other", "review", t)).toBeNull();
    expect(await verifyToken(SECRET, "review", `${body}.x${sig.slice(1)}`)).toBeNull();
    expect(await verifyToken(SECRET, "review", null)).toBeNull();
  });
  it("upload tokens are tied to shop and product, and expire", async () => {
    const now = Date.now();
    const t = await signUploadToken(SECRET, SHOP, "11", now);
    expect(await verifyUploadToken(SECRET, SHOP, "11", t, now)).toBe(true);
    expect(await verifyUploadToken(SECRET, SHOP, "12", t, now)).toBe(false);
    expect(await verifyUploadToken(SECRET, "b.myshopify.com", "11", t, now)).toBe(false);
    expect(await verifyUploadToken(SECRET, SHOP, "11", t, now + 3 * 3600_000)).toBe(false);
  });
});

describe("buildRequestEmail", () => {
  const args = {
    shopName: "Snow <Shop>",
    firstName: "Ann",
    orderName: "#1001",
    products: [{ numericId: "11", title: 'Board "X" <b>', imageUrl: "https://cdn/x.jpg" }],
    writeUrl: "https://store.com/apps/storevine-reviews/write?t=T",
    unsubscribeUrl: "https://reviews.storevine.app/unsubscribe?t=U",
  };
  it("escapes shop and product text and links each star", () => {
    const { html, subject, text } = buildRequestEmail(args);
    expect(html).not.toContain("<b>");
    expect(html).toContain("Snow &lt;Shop&gt;");
    expect(html).toContain("&amp;p=11&amp;r=5");
    expect(html).toContain("unsubscribe?t=U");
    expect(subject).toContain('Board "X"');
    expect(text).toContain("write?t=T&p=11");
  });
  it("uses neutral wording with no incentive", () => {
    const { html } = buildRequestEmail(args);
    expect(html).toMatch(/whatever the rating/);
    expect(html).not.toMatch(/discount|coupon|reward|% off/i);
  });
});

function fakeDeps(over: Partial<Awaited<ReturnType<SendDeps["shopContext"]>>> = {}, sent: Array<Record<string, unknown>> = []) {
  const deps: SendDeps = {
    db,
    secret: SECRET,
    appUrl: "https://reviews.storevine.app",
    email: { send: async (m) => { sent.push(m); return { messageId: `m${sent.length}` }; } },
    shopContext: async () => ({
      enabled: true,
      monthlyLimit: 50,
      shopName: "Snow Shop",
      replyTo: "owner@shop.test",
      storefrontUrl: "https://store.com",
      products: async (ids) => ids.map((id) => ({ numericId: id.split("/").pop()!, title: `P${id.split("/").pop()}`, imageUrl: null })),
      ...over,
    }),
  };
  return deps;
}

describe("scheduling and sending", () => {
  it("schedules once per order and waits for the delay", async () => {
    const now = new Date("2026-10-01T00:00:00Z");
    await scheduleRequest(db, SHOP, parseOrder(orderPayload)!, 7, now);
    await scheduleRequest(db, SHOP, parseOrder(orderPayload)!, 7, now); // webhook retry
    expect(await recentRequests(db, SHOP)).toHaveLength(1);
    const sent: Array<Record<string, unknown>> = [];
    const early = await processDueRequests(fakeDeps({}, sent), new Date("2026-10-05T00:00:00Z"));
    expect(early.sent).toBe(0);
    const due = await processDueRequests(fakeDeps({}, sent), new Date("2026-10-08T01:00:00Z"));
    expect(due.sent).toBe(1);
    expect(sent[0]).toMatchObject({ to: "ann@example.com", from: { email: "reviews@storevine.app", name: "Snow Shop" }, replyTo: "owner@shop.test" });
    expect((sent[0].headers as Record<string, string>)["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(String(sent[0].html)).toContain("https://store.com/apps/storevine-reviews/write?t=");
    expect((await recentRequests(db, SHOP))[0].status).toBe("sent");
  });

  it("leaves requests waiting when email isn't set up", async () => {
    await scheduleRequest(db, SHOP, parseOrder(orderPayload)!, 0);
    const deps = { ...fakeDeps(), email: undefined };
    expect((await processDueRequests(deps)).sent).toBe(0);
    expect((await recentRequests(db, SHOP))[0].status).toBe("scheduled");
  });

  it("respects opt-outs, turned-off setting, plan limit and missing products", async () => {
    await scheduleRequest(db, SHOP, parseOrder(orderPayload)!, 0);
    await unsubscribe(db, SHOP, "ann@example.com");
    expect((await recentRequests(db, SHOP))[0].status).toBe("unsubscribed");
    expect(await isUnsubscribed(db, SHOP, "ANN@example.com ")).toBe(true);

    await scheduleRequest(db, SHOP, parseOrder({ ...orderPayload, id: 2, admin_graphql_api_id: "gid://shopify/Order/2", email: "b@x.io" })!, 0);
    expect((await processDueRequests(fakeDeps({ enabled: false }))).skipped).toBe(1);

    await scheduleRequest(db, SHOP, parseOrder({ ...orderPayload, id: 3, admin_graphql_api_id: "gid://shopify/Order/3", email: "c@x.io" })!, 0);
    expect((await processDueRequests(fakeDeps({ monthlyLimit: 0 }))).limit).toBe(1);

    await scheduleRequest(db, SHOP, parseOrder({ ...orderPayload, id: 4, admin_graphql_api_id: "gid://shopify/Order/4", email: "d@x.io" })!, 0);
    expect((await processDueRequests(fakeDeps({ products: async () => [] }))).skipped).toBe(1);
  });

  it("records send failures instead of retrying forever", async () => {
    await scheduleRequest(db, SHOP, parseOrder(orderPayload)!, 0);
    const deps = { ...fakeDeps(), email: { send: async () => { throw new Error("E_SENDER_NOT_VERIFIED"); } } };
    expect((await processDueRequests(deps)).failed).toBe(1);
    const [row] = await recentRequests(db, SHOP);
    expect(row).toMatchObject({ status: "failed", note: "E_SENDER_NOT_VERIFIED" });
  });
});

describe("privacy", () => {
  it("exports and redacts a customer's requests; opt-out survives only as a hash", async () => {
    await scheduleRequest(db, SHOP, parseOrder(orderPayload)!, 0);
    await unsubscribe(db, SHOP, "ann@example.com");
    expect(await exportCustomerRequests(db, SHOP, { customer: { email: "ann@example.com" } })).toContain("#1001");
    expect(await redactCustomerRequests(db, SHOP, { customer: { email: "ann@example.com" }, orders_to_redact: [1001] })).toContain("Deleted 1");
    expect(await recentRequests(db, SHOP)).toHaveLength(0);
    const { results } = await d1.prepare("SELECT email_hash FROM review_unsubscribe").all<{ email_hash: string }>();
    expect(results[0].email_hash).toBe(await emailHash(SHOP, "ann@example.com"));
    expect(results[0].email_hash).not.toContain("@");
  });
});

describe("request reviews", () => {
  it("validates input and allows one review per product per request", async () => {
    expect(validateRequestReview({ rating: "0", author: "A", body: "Nice" }).error).toBeTruthy();
    const ok = validateRequestReview({ rating: "4", author: "Ann", body: "Nice board" }).input!;
    const base = { ...ok, productId: "gid://shopify/Product/11", status: "published" as const, source: "request" as const, verified: true, requestId: "r1" };
    await createReview(db, SHOP, base);
    await expect(createReview(db, SHOP, base)).rejects.toThrow();
    expect(await reviewedFromRequest(db, SHOP, "r1")).toEqual(new Set(["gid://shopify/Product/11"]));
  });
});

describe("photos and export", () => {
  it("detects real image types from bytes", () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.type).toBe("image/jpeg");
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))?.type).toBe("image/png");
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))?.type).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(parsePhotos("not json")).toEqual([]);
  });
  it("exports CSV with quoting", async () => {
    await createReview(db, SHOP, { productId: "gid://shopify/Product/1", productHandle: "board", rating: 5, title: 'Big, "great"', body: "Line1\nLine2", author: "Ann", status: "published", verified: true });
    const csv = await exportCsv(db, SHOP);
    const [header, row] = csv.split("\r\n");
    expect(header.startsWith("product_handle,rating,title,body,author,created_at")).toBe(true);
    expect(row).toContain('"Big, ""great"""');
    expect(csv).toContain('"Line1\nLine2"');
    expect(row).toContain(",yes,");
  });
});

describe("health signals", () => {
  const insert = (id: string, status: string, sendAfter: string, sentAt: string | null) =>
    d1
      .prepare("INSERT INTO review_request (id, shop, order_id, email, product_ids, send_after, status, sent_at, created_at) VALUES (?, ?, ?, 'x@example.com', '[]', ?, ?, ?, ?)")
      .bind(id, SHOP, `gid://shopify/Order/${id}`, sendAfter, status, sentAt, sendAfter)
      .run();
  const now = new Date("2026-10-01T15:11:00Z");
  const problems = async () => Object.fromEntries((await reviewSignals(d1, SHOP, now)).map((s) => [s.key, s.problem]));

  it("is healthy with nothing to send", async () => {
    expect(await problems()).toEqual({ request_failures: null, request_backlog: null });
  });
  it("flags failures that outnumber sends in the last day", async () => {
    await insert("1", "failed", "2026-10-01T10:00:00Z", "2026-10-01T10:00:00Z");
    expect((await problems()).request_failures).toMatch(/^1 review request email failed/);
    await insert("2", "sent", "2026-10-01T10:00:00Z", "2026-10-01T10:00:00Z");
    await insert("3", "sent", "2026-10-01T11:00:00Z", "2026-10-01T11:00:00Z");
    expect((await problems()).request_failures).toBeNull();
  });
  it("ignores old failures and flags overdue requests", async () => {
    await insert("4", "failed", "2026-09-20T10:00:00Z", "2026-09-20T10:00:00Z");
    await insert("5", "scheduled", "2026-10-01T01:00:00Z", null);
    await insert("6", "scheduled", "2026-10-01T14:00:00Z", null); // due, but within the grace period
    const p = await problems();
    expect(p.request_failures).toBeNull();
    expect(p.request_backlog).toBe("1 review request email is overdue and not sending.");
  });
  it("records when a failure happened", async () => {
    await insert("7", "scheduled", "2026-10-01T01:00:00Z", null);
    await markRequest(db, "7", "failed", "boom", new Date("2026-10-01T12:00:00Z"));
    const row = await d1.prepare("SELECT sent_at FROM review_request WHERE id = '7'").first<{ sent_at: string }>();
    expect(row?.sent_at).toBe("2026-10-01T12:00:00.000Z");
  });
});

describe("BFS: Flow trigger payload and admin block", () => {
  it("maps a review to the Flow trigger fields", async () => {
    const { reviewSubmittedPayload } = await import("../app/lib/flow-payload");
    expect(
      reviewSubmittedPayload({ productId: "gid://shopify/Product/42", rating: 4, title: "Nice", body: "x".repeat(6000), author: "Ann", verified: true, status: "pending", photos: 2 }),
    ).toMatchObject({ product_id: 42, Rating: 4, Title: "Nice", Author: "Ann", Verified: true, Status: "pending", Photos: 2 });
  });
  it("summarises a product for the admin block", async () => {
    const { productAdminSummary } = await import("../app/lib/reviews.server");
    const P = "gid://shopify/Product/9";
    await createReview(db, SHOP, { productId: P, rating: 5, title: "A", body: "Great", author: "Ann", status: "published" });
    await createReview(db, SHOP, { productId: P, rating: 3, title: "B", body: "Ok", author: "Bo", status: "published" });
    await createReview(db, SHOP, { productId: P, rating: 1, title: "C", body: "Bad", author: "Cy", status: "pending" });
    const s = await productAdminSummary(db, SHOP, P);
    expect(s).toMatchObject({ count: 2, average: 4, pending: 1 });
    expect(s.latest).toHaveLength(3);
  });
});
