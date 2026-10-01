import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimWebhook,
  complianceLogTable,
  getDb,
  handleComplianceWebhook,
  normaliseTopic,
  recordInstall,
  recordUninstall,
  runMigrations,
  sessionTable,
  shopTable,
} from "../src";

const proxy = await getPlatformProxy<{ DB: D1Database }>({
  configPath: join(import.meta.dirname, "wrangler.test.jsonc"),
  persist: { path: mkdtempSync(join(tmpdir(), "upwise-d1-")) },
});
const d1 = proxy.env.DB;
const db = getDb(d1);

afterAll(() => proxy.dispose());

async function seedSession(shop: string) {
  await db.insert(sessionTable).values({
    id: `offline_${shop}`,
    shop,
    state: "x",
    isOnline: false,
    accessToken: "token",
  });
}

describe("migrations", () => {
  it("apply once and are idempotent", async () => {
    const first = await runMigrations(d1);
    const second = await runMigrations(d1);
    expect(first.length === 0 || first[0] === 1).toBe(true);
    expect(second).toEqual([]);
    const { results } = await d1.prepare("SELECT id FROM _migrations ORDER BY id").all<{ id: number }>();
    expect(results.map((r) => r.id)).toEqual([1, 2]);
  });
});

describe("shops and webhooks", () => {
  beforeEach(async () => {
    await runMigrations(d1);
    await d1.batch([
      d1.prepare("DELETE FROM session"),
      d1.prepare("DELETE FROM shop"),
      d1.prepare("DELETE FROM processed_webhook"),
      d1.prepare("DELETE FROM compliance_log"),
    ]);
  });

  it("records install and uninstall, deleting sessions", async () => {
    await recordInstall(db, "a.myshopify.com");
    await seedSession("a.myshopify.com");
    await recordUninstall(db, "a.myshopify.com");
    expect(await db.select().from(sessionTable)).toHaveLength(0);
    const [shop] = await db.select().from(shopTable);
    expect(shop.uninstalledAt).not.toBeNull();
    await recordInstall(db, "a.myshopify.com");
    const [again] = await db.select().from(shopTable);
    expect(again.uninstalledAt).toBeNull();
  });

  it("claims a webhook id only once", async () => {
    expect(await claimWebhook(db, "w1", "APP_UNINSTALLED", "a.myshopify.com")).toBe(true);
    expect(await claimWebhook(db, "w1", "APP_UNINSTALLED", "a.myshopify.com")).toBe(false);
    expect(await claimWebhook(db, undefined, "APP_UNINSTALLED", "a.myshopify.com")).toBe(true);
  });

  it("shop/redact deletes all shop data and logs completion", async () => {
    await recordInstall(db, "a.myshopify.com");
    await recordInstall(db, "b.myshopify.com");
    await seedSession("a.myshopify.com");
    await seedSession("b.myshopify.com");
    let purged = false;
    const result = await handleComplianceWebhook(
      db,
      { topic: "shop/redact", shop: "a.myshopify.com", webhookId: "w2", payload: {} },
      { purgeShop: async () => { purged = true; } },
    );
    expect(result.topic).toBe("SHOP_REDACT");
    expect(purged).toBe(true);
    const sessions = await db.select().from(sessionTable);
    expect(sessions.map((s) => s.shop)).toEqual(["b.myshopify.com"]);
    const shops = await db.select().from(shopTable);
    expect(shops.map((s) => s.shop)).toEqual(["b.myshopify.com"]);
    const [log] = await db.select().from(complianceLogTable);
    expect(log.completedAt).not.toBeNull();
  });

  it("customer topics succeed when the app holds no customer data", async () => {
    const r1 = await handleComplianceWebhook(db, { topic: "CUSTOMERS_DATA_REQUEST", shop: "a.myshopify.com", payload: {} });
    const r2 = await handleComplianceWebhook(db, { topic: "customers/redact", shop: "a.myshopify.com", payload: {} });
    expect(r1.note).toMatch(/nothing to export/);
    expect(r2.note).toMatch(/nothing to redact/);
  });

  it("rejects non-compliance topics", async () => {
    expect(normaliseTopic("orders/create")).toBeNull();
    await expect(
      handleComplianceWebhook(db, { topic: "orders/create", shop: "a", payload: {} }),
    ).rejects.toThrow();
  });
});
