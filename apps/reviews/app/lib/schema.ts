import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Migration } from "@upwise/platform";

export const reviewTable = sqliteTable("review", {
  id: text("id").primaryKey(),
  shop: text("shop").notNull(),
  productId: text("product_id").notNull(), // gid://shopify/Product/..
  productHandle: text("product_handle").notNull().default(""),
  productTitle: text("product_title").notNull().default(""),
  rating: integer("rating").notNull(), // 1..5
  title: text("title").notNull().default(""),
  body: text("body").notNull(),
  author: text("author").notNull(),
  /** published = visible; pending = awaiting approval; hidden = removed for abuse/spam/irrelevance only. */
  status: text("status", { enum: ["published", "pending", "hidden"] }).notNull(),
  reply: text("reply"),
  source: text("source", { enum: ["storefront", "import"] }).notNull().default("storefront"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const appSettingTable = sqliteTable(
  "app_setting",
  { shop: text("shop").notNull(), key: text("key").notNull(), value: text("value").notNull() },
  (t) => [primaryKey({ columns: [t.shop, t.key] })],
);

export const appMigrations: Migration[] = [
  {
    id: 101,
    name: "create_review",
    sql: [
      `CREATE TABLE IF NOT EXISTS review (
        id TEXT PRIMARY KEY NOT NULL,
        shop TEXT NOT NULL,
        product_id TEXT NOT NULL,
        product_handle TEXT NOT NULL DEFAULT '',
        product_title TEXT NOT NULL DEFAULT '',
        rating INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL,
        author TEXT NOT NULL,
        status TEXT NOT NULL,
        reply TEXT,
        source TEXT NOT NULL DEFAULT 'storefront',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS review_shop_product_idx ON review (shop, product_id, status)`,
      `CREATE INDEX IF NOT EXISTS review_shop_created_idx ON review (shop, created_at)`,
    ],
  },
  {
    id: 102,
    name: "create_app_setting",
    sql: [
      `CREATE TABLE IF NOT EXISTS app_setting (
        shop TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (shop, key)
      )`,
    ],
  },
];
