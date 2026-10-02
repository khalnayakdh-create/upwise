import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import type { D1Database } from "@cloudflare/workers-types";
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
import { buildHealthEmail, dropToZeroSignal, getHealthState, runHealthCheck } from "../src/health";

const proxy = await getPlatformProxy<{ DB: D1Database }>({
  configPath: join(import.meta.dirname, "wrangler.test.jsonc"),
  persist: { path: mkdtempSync(join(tmpdir(), "storevine-d1-")) },
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

describe("migration races", () => {
  it("treats a duplicate-column failure as already applied", async () => {
    await runMigrations(d1);
    await d1.prepare("CREATE TABLE IF NOT EXISTS race_t (id TEXT)").run();
    await d1.prepare("ALTER TABLE race_t ADD COLUMN extra INTEGER").run(); // "another isolate" won
    const m = [{ id: 900, name: "race_add_column", sql: ["ALTER TABLE race_t ADD COLUMN extra INTEGER"] }];
    await expect(runMigrations(d1, m)).resolves.toEqual([]);
    const row = await d1.prepare("SELECT id FROM _migrations WHERE id = 900").first<{ id: number }>();
    expect(row?.id).toBe(900);
  });
  it("still throws real migration errors", async () => {
    const bad = [{ id: 901, name: "bad", sql: ["THIS IS NOT SQL"] }];
    await expect(runMigrations(d1, bad)).rejects.toThrow();
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
    await recordUninstall(db, "a.myshopify.com");
    await seedSession("a.myshopify.com");
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

  it("shop/redact keeps data when the shop has reinstalled since", async () => {
    await recordInstall(db, "a.myshopify.com");
    await recordUninstall(db, "a.myshopify.com");
    await recordInstall(db, "a.myshopify.com"); // reinstalled within 48h
    await seedSession("a.myshopify.com");
    const result = await handleComplianceWebhook(db, {
      topic: "shop/redact", shop: "a.myshopify.com", payload: {},
    });
    expect(result.note).toMatch(/reinstalled/);
    expect(await db.select().from(sessionTable)).toHaveLength(1);
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

describe("health checks", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const rows = (yesterday: number, perDay: number) => [
    { day: "2026-10-09", n: yesterday },
    ...[2, 3, 4, 5, 6, 7, 8].map((i) => ({ day: new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10), n: perDay })),
  ];

  it("flags a drop to zero only with enough normal traffic", () => {
    expect(dropToZeroSignal("views", "cart offer views", rows(0, 20), now).problem).toMatch(/No cart offer views yesterday \(usually about 20 a day\)/);
    expect(dropToZeroSignal("views", "views", rows(3, 20), now).problem).toBeNull();
    expect(dropToZeroSignal("views", "views", rows(0, 2), now).problem).toBeNull(); // too little traffic to judge
  });

  it("alerts once per cooldown, keeps the banner, and clears on recovery", async () => {
    await d1.exec("CREATE TABLE IF NOT EXISTS app_setting (shop TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (shop, key))");
    await d1.exec("DELETE FROM app_setting");
    await recordInstall(db, "h.myshopify.com");
    let broken = true;
    const sent: string[][] = [];
    const run = (at: Date) =>
      runHealthCheck({
        d1,
        now: at,
        signalsFor: async () => [{ key: "views", problem: broken ? "No views" : null }],
        notify: async (_shop, problems) => { sent.push(problems.map((p) => p.key)); },
      });
    await run(now);
    await run(new Date(now.getTime() + 86_400_000)); // next day: still broken, inside cooldown
    expect(sent).toEqual([["views"]]);
    expect((await getHealthState(d1, "h.myshopify.com"))?.problems.map((p) => p.key)).toEqual(["views"]);
    await run(new Date(now.getTime() + 8 * 86_400_000)); // after cooldown: one more email
    expect(sent).toHaveLength(2);
    broken = false;
    await run(new Date(now.getTime() + 9 * 86_400_000));
    expect((await getHealthState(d1, "h.myshopify.com"))?.problems).toEqual([]);
  });

  it("builds an escaped alert email", () => {
    const e = buildHealthEmail({ appName: "Storevine Bundles", shopName: "Snow <Shop>", problems: ["No views"], adminUrl: "https://admin.shopify.com/store/x/apps/y" });
    expect(e.html).toContain("Snow &lt;Shop&gt;");
    expect(e.text).toContain("- No views");
  });
});
