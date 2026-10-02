import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Migration } from "@upwise/platform";

/** A cart offer: when the trigger matches the cart, recommend these products. */
export const offerTable = sqliteTable("offer", {
  id: text("id").primaryKey(),
  shop: text("shop").notNull(),
  name: text("name").notNull(),
  status: text("status", { enum: ["active", "paused"] }).notNull().default("active"),
  triggerType: text("trigger_type", { enum: ["all", "products"] }).notNull().default("all"),
  /** JSON array of Product GIDs that trigger the offer (when triggerType = products). */
  triggerProductIds: text("trigger_product_ids").notNull().default("[]"),
  /** JSON array of OfferProduct snapshots (see offers.server.ts). */
  offerProducts: text("offer_products").notNull().default("[]"),
  headline: text("headline").notNull(),
  priority: integer("priority").notNull().default(0),
  /** 0 = no discount. Applied by the storevine-cart-discount Function (paid plans). */
  discountPercent: integer("discount_percent").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Daily storefront counters per offer (no shopper data). */
export const offerStatTable = sqliteTable(
  "offer_stat_daily",
  {
    shop: text("shop").notNull(),
    offerId: text("offer_id").notNull(),
    day: text("day").notNull(), // YYYY-MM-DD (UTC)
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    adds: integer("adds").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.shop, t.offerId, t.day] })],
);

/** Per-shop key/value settings (e.g. discount id, thank-you config). */
export const appSettingTable = sqliteTable(
  "app_setting",
  {
    shop: text("shop").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.shop, t.key] })],
);

/** Order lines added from a cart offer (tagged _storevine_offer). Money in shop currency cents. No customer data. */
export const offerOrderTable = sqliteTable(
  "offer_order",
  {
    shop: text("shop").notNull(),
    orderId: text("order_id").notNull(),
    offerId: text("offer_id").notNull(),
    day: text("day").notNull(),
    units: integer("units").notNull(),
    revenueCents: integer("revenue_cents").notNull(),
    discountCents: integer("discount_cents").notNull(),
    refundedCents: integer("refunded_cents").notNull().default(0),
    currency: text("currency").notNull(),
  },
  (t) => [primaryKey({ columns: [t.shop, t.orderId, t.offerId] })],
);

/** Orders from carts that were in the holdout test ("h" = offers hidden, "s" = offers shown). */
export const cartOrderTable = sqliteTable(
  "cart_order",
  {
    shop: text("shop").notNull(),
    orderId: text("order_id").notNull(),
    day: text("day").notNull(),
    grp: text("grp").notNull(),
    totalCents: integer("total_cents").notNull(),
    refundedCents: integer("refunded_cents").notNull().default(0),
    currency: text("currency").notNull(),
  },
  (t) => [primaryKey({ columns: [t.shop, t.orderId] })],
);

/** Eligible carts per holdout group per day (denominator for conversion and revenue per cart). */
export const holdoutStatTable = sqliteTable(
  "holdout_stat_daily",
  {
    shop: text("shop").notNull(),
    day: text("day").notNull(),
    grp: text("grp").notNull(),
    carts: integer("carts").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.shop, t.day, t.grp] })],
);

/** App-specific migrations. IDs 100+ (platform uses 1-99). Append only. */
export const cartUpsellMigrations: Migration[] = [
  {
    id: 101,
    name: "create_offer",
    sql: [
      `CREATE TABLE IF NOT EXISTS offer (
        id TEXT PRIMARY KEY NOT NULL,
        shop TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        trigger_type TEXT NOT NULL DEFAULT 'all',
        trigger_product_ids TEXT NOT NULL DEFAULT '[]',
        offer_products TEXT NOT NULL DEFAULT '[]',
        headline TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS offer_shop_idx ON offer (shop)`,
    ],
  },
  {
    id: 102,
    name: "create_offer_stat_daily",
    sql: [
      `CREATE TABLE IF NOT EXISTS offer_stat_daily (
        shop TEXT NOT NULL,
        offer_id TEXT NOT NULL,
        day TEXT NOT NULL,
        impressions INTEGER NOT NULL DEFAULT 0,
        clicks INTEGER NOT NULL DEFAULT 0,
        adds INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (shop, offer_id, day)
      )`,
    ],
  },
  {
    id: 103,
    name: "offer_discount_percent",
    sql: [`ALTER TABLE offer ADD COLUMN discount_percent INTEGER NOT NULL DEFAULT 0`],
  },
  {
    id: 104,
    name: "create_app_setting",
    sql: [
      `CREATE TABLE IF NOT EXISTS app_setting (
        shop TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (shop, key)
      )`,
    ],
  },
  {
    id: 105,
    name: "attribution_and_holdout",
    sql: [
      `CREATE TABLE IF NOT EXISTS offer_order (
        shop TEXT NOT NULL, order_id TEXT NOT NULL, offer_id TEXT NOT NULL, day TEXT NOT NULL,
        units INTEGER NOT NULL, revenue_cents INTEGER NOT NULL, discount_cents INTEGER NOT NULL,
        refunded_cents INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL,
        PRIMARY KEY (shop, order_id, offer_id)
      )`,
      `CREATE INDEX IF NOT EXISTS offer_order_day_idx ON offer_order (shop, day)`,
      `CREATE TABLE IF NOT EXISTS cart_order (
        shop TEXT NOT NULL, order_id TEXT NOT NULL, day TEXT NOT NULL, grp TEXT NOT NULL,
        total_cents INTEGER NOT NULL, refunded_cents INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL,
        PRIMARY KEY (shop, order_id)
      )`,
      `CREATE INDEX IF NOT EXISTS cart_order_day_idx ON cart_order (shop, day)`,
      `CREATE TABLE IF NOT EXISTS holdout_stat_daily (
        shop TEXT NOT NULL, day TEXT NOT NULL, grp TEXT NOT NULL, carts INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (shop, day, grp)
      )`,
    ],
  },
];
