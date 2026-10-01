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
  source: text("source", { enum: ["storefront", "import", "request"] }).notNull().default("storefront"),
  /** 1 = written from a review-request email tied to a real order (verified buyer). */
  verified: integer("verified").notNull().default(0),
  /** JSON array of R2 object keys for photos attached to the review. */
  photos: text("photos").notNull().default("[]"),
  /** Review request this came from (one review per product per request). */
  requestId: text("request_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** One row per fulfilled order we may email a review request for. */
export const reviewRequestTable = sqliteTable("review_request", {
  id: text("id").primaryKey(),
  shop: text("shop").notNull(),
  orderId: text("order_id").notNull(),
  orderName: text("order_name").notNull().default(""),
  email: text("email").notNull(),
  firstName: text("first_name").notNull().default(""),
  /** JSON array of product gids from the order. */
  productIds: text("product_ids").notNull(),
  sendAfter: text("send_after").notNull(),
  /** scheduled → sent | skipped | failed | unsubscribed | limit */
  status: text("status").notNull(),
  note: text("note"),
  sentAt: text("sent_at"),
  createdAt: text("created_at").notNull(),
});

/** Opt-outs, stored as SHA-256(shop:email) so we keep no plain address after redaction. */
export const reviewUnsubscribeTable = sqliteTable(
  "review_unsubscribe",
  { shop: text("shop").notNull(), emailHash: text("email_hash").notNull(), createdAt: text("created_at").notNull() },
  (t) => [primaryKey({ columns: [t.shop, t.emailHash] })],
);

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
  {
    id: 103,
    name: "review_requests_photos_verified",
    sql: [
      `ALTER TABLE review ADD COLUMN verified INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE review ADD COLUMN photos TEXT NOT NULL DEFAULT '[]'`,
      `ALTER TABLE review ADD COLUMN request_id TEXT`,
      `CREATE UNIQUE INDEX IF NOT EXISTS review_request_product_idx ON review (request_id, product_id) WHERE request_id IS NOT NULL`,
      `CREATE TABLE IF NOT EXISTS review_request (
        id TEXT PRIMARY KEY NOT NULL,
        shop TEXT NOT NULL,
        order_id TEXT NOT NULL,
        order_name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL,
        first_name TEXT NOT NULL DEFAULT '',
        product_ids TEXT NOT NULL,
        send_after TEXT NOT NULL,
        status TEXT NOT NULL,
        note TEXT,
        sent_at TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS review_request_order_idx ON review_request (shop, order_id)`,
      `CREATE INDEX IF NOT EXISTS review_request_due_idx ON review_request (status, send_after)`,
      `CREATE TABLE IF NOT EXISTS review_unsubscribe (
        shop TEXT NOT NULL, email_hash TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (shop, email_hash)
      )`,
    ],
  },
];
