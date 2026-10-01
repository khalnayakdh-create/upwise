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
];
