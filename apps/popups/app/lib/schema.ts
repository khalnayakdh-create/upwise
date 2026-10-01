import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Migration } from "@upwise/platform";

export const appSettingTable = sqliteTable(
  "app_setting",
  { shop: text("shop").notNull(), key: text("key").notNull(), value: text("value").notNull() },
  (t) => [primaryKey({ columns: [t.shop, t.key] })],
);

/** Daily counters (no shopper data; emails go straight to Shopify customers). */
export const popupStatTable = sqliteTable(
  "popup_stat_daily",
  {
    shop: text("shop").notNull(),
    day: text("day").notNull(),
    impressions: integer("impressions").notNull().default(0),
    signups: integer("signups").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.shop, t.day] })],
);

export const appMigrations: Migration[] = [
  {
    id: 101,
    name: "create_app_setting_and_stats",
    sql: [
      `CREATE TABLE IF NOT EXISTS app_setting (
        shop TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (shop, key)
      )`,
      `CREATE TABLE IF NOT EXISTS popup_stat_daily (
        shop TEXT NOT NULL, day TEXT NOT NULL,
        impressions INTEGER NOT NULL DEFAULT 0, signups INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (shop, day)
      )`,
    ],
  },
];
