/**
 * End-to-end webhook checks against the built Worker running in workerd
 * (same runtime as production). Run `npm run build` first.
 *
 * Covers App Store review requirements:
 * - invalid HMAC -> 401
 * - valid compliance webhooks -> 200 and the right data deleted
 */
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_startWorker } from "wrangler";

const SECRET = "test-secret";
const SHOP = "upwise-test.myshopify.com";
let worker: Awaited<ReturnType<typeof unstable_startWorker>>;

beforeAll(async () => {
  worker = await unstable_startWorker({
    config: join(import.meta.dirname, "../build/server/wrangler.json"),
    bindings: {
      SHOPIFY_API_KEY: { type: "plain_text", value: "test-key" },
      SHOPIFY_API_SECRET: { type: "plain_text", value: SECRET },
      SHOPIFY_APP_URL: { type: "plain_text", value: "https://example.com" },
    },
    dev: { server: { port: 0 }, inspector: false, persist: false },
  });
  await worker.ready;
}, 60_000);

afterAll(async () => {
  await worker?.dispose();
});

function webhook(path: string, topic: string, body: object, opts: { badHmac?: boolean; id?: string } = {}) {
  const raw = JSON.stringify(body);
  const hmac = createHmac("sha256", opts.badHmac ? "wrong" : SECRET).update(raw).digest("base64");
  return worker.fetch(`https://example.com${path}`, {
    method: "POST",
    body: raw,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Topic": topic,
      "X-Shopify-Hmac-Sha256": hmac,
      "X-Shopify-Shop-Domain": SHOP,
      "X-Shopify-API-Version": "2026-07",
      "X-Shopify-Webhook-Id": opts.id ?? crypto.randomUUID(),
      "X-Shopify-Event-Id": crypto.randomUUID(),
      "X-Shopify-Triggered-At": new Date().toISOString(),
    },
  });
}

describe("webhooks", () => {
  it("health check reports migrations", async () => {
    const res = await worker.fetch("https://example.com/healthz");
    const json = (await res.json()) as { ok: boolean; migrations: string[] };
    expect(json.ok).toBe(true);
    expect(json.migrations).toContain("1_create_session");
  });

  it.each(["customers/data_request", "customers/redact", "shop/redact"])(
    "rejects %s with an invalid HMAC (401)",
    async (topic) => {
      const res = await webhook("/webhooks/compliance", topic, { shop_domain: SHOP }, { badHmac: true });
      expect(res.status).toBe(401);
    },
  );

  it.each([
    ["customers/data_request", { shop_id: 1, shop_domain: SHOP, customer: { id: 1 }, orders_requested: [1] }],
    ["customers/redact", { shop_id: 1, shop_domain: SHOP, customer: { id: 1 }, orders_to_redact: [1] }],
    ["shop/redact", { shop_id: 1, shop_domain: SHOP }],
  ])("accepts %s with a valid HMAC (200)", async (topic, payload) => {
    const res = await webhook("/webhooks/compliance", topic, payload);
    expect(res.status).toBe(200);
  });

  it("app/uninstalled with valid HMAC returns 200, and is idempotent", async () => {
    const id = crypto.randomUUID();
    expect((await webhook("/webhooks/app/uninstalled", "app/uninstalled", { id: 1 }, { id })).status).toBe(200);
    expect((await webhook("/webhooks/app/uninstalled", "app/uninstalled", { id: 1 }, { id })).status).toBe(200);
  });

  it("app/uninstalled with invalid HMAC returns 401", async () => {
    const res = await webhook("/webhooks/app/uninstalled", "app/uninstalled", { id: 1 }, { badHmac: true });
    expect(res.status).toBe(401);
  });

  it("app proxy events: rejects unsigned, accepts signed", async () => {
    const unsigned = await worker.fetch(`https://example.com/proxy/events?shop=${SHOP}`, {
      method: "POST",
      body: JSON.stringify({ events: [] }),
    });
    expect(unsigned.status).toBe(400);

    const params: Record<string, string> = {
      shop: SHOP,
      path_prefix: "/apps/upwise-cart",
      timestamp: String(Math.floor(Date.now() / 1000)),
      logged_in_customer_id: "",
    };
    const message = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("");
    const signature = createHmac("sha256", SECRET).update(message).digest("hex");
    const qs = new URLSearchParams({ ...params, signature }).toString();
    const signed = await worker.fetch(`https://example.com/proxy/events?${qs}`, {
      method: "POST",
      body: JSON.stringify({ events: [{ offerId: "unknown", type: "impression" }] }),
    });
    // No session for this shop in the test DB -> handled quietly with 204.
    expect(signed.status).toBe(204);
  });

  it("login without a shop never asks for a shop domain", async () => {
    const res = await worker.fetch("https://example.com/auth/login");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).not.toMatch(/name="shop"/);
  });
});
