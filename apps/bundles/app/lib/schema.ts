import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Migration } from "@upwise/platform";

export const bundleTable = sqliteTable("bundle", {
  id: text("id").primaryKey(),
  shop: text("shop").notNull(),
  name: text("name").notNull(),
  title: text("title").notNull(), // shown to shoppers
  status: text("status", { enum: ["active", "paused"] }).notNull().default("active"),
  /** JSON BundleProduct[] (2-5) */
  products: text("products").notNull(),
  discountPercent: integer("discount_percent").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const appSettingTable = sqliteTable(
  "app_setting",
  { shop: text("shop").notNull(), key: text("key").notNull(), value: text("value").notNull() },
  (t) => [primaryKey({ columns: [t.shop, t.key] })],
);

export const bundleStatTable = sqliteTable(
  "bundle_stat_daily",
  {
    shop: text("shop").notNull(),
    bundleId: text("bundle_id").notNull(),
    day: text("day").notNull(),
    impressions: integer("impressions").notNull().default(0),
    adds: integer("adds").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.shop, t.bundleId, t.day] })],
);

export const appMigrations: Migration[] = [
  {
    id: 101,
    name: "create_bundle_tables",
    sql: [
      `CREATE TABLE IF NOT EXISTS bundle (
        id TEXT PRIMARY KEY NOT NULL, shop TEXT NOT NULL, name TEXT NOT NULL, title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active', products TEXT NOT NULL,
        discount_percent INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS bundle_shop_idx ON bundle (shop)`,
      `CREATE TABLE IF NOT EXISTS app_setting (
        shop TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (shop, key)
      )`,
      `CREATE TABLE IF NOT EXISTS bundle_stat_daily (
        shop TEXT NOT NULL, bundle_id TEXT NOT NULL, day TEXT NOT NULL,
        impressions INTEGER NOT NULL DEFAULT 0, adds INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (shop, bundle_id, day)
      )`,
    ],
  },
];
