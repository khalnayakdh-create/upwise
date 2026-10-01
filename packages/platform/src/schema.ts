import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Shopify session storage table. Column names must match what
 * @shopify/shopify-app-session-storage-drizzle (SQLite adapter) reads/writes.
 */
export const sessionTable = sqliteTable("session", {
  id: text("id").primaryKey(),
  shop: text("shop").notNull(),
  state: text("state").notNull(),
  isOnline: integer("isOnline", { mode: "boolean" }).notNull().default(false),
  scope: text("scope"),
  expires: text("expires"),
  accessToken: text("accessToken").notNull(),
  userId: blob("userId", { mode: "bigint" }),
  firstName: text("firstName"),
  lastName: text("lastName"),
  email: text("email"),
  accountOwner: integer("accountOwner", { mode: "boolean" }),
  locale: text("locale"),
  collaborator: integer("collaborator", { mode: "boolean" }),
  emailVerified: integer("emailVerified", { mode: "boolean" }),
  refreshToken: text("refreshToken"),
  refreshTokenExpires: text("refreshTokenExpires"),
});

/** One row per shop that has ever installed the app. */
export const shopTable = sqliteTable("shop", {
  shop: text("shop").primaryKey(),
  installedAt: text("installed_at").notNull(),
  uninstalledAt: text("uninstalled_at"),
  plan: text("plan").notNull().default("free"),
});

/** Audit trail for privacy (compliance) webhooks. Holds no customer PII. */
export const complianceLogTable = sqliteTable("compliance_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  shop: text("shop").notNull(),
  topic: text("topic").notNull(),
  webhookId: text("webhook_id"),
  receivedAt: text("received_at").notNull(),
  completedAt: text("completed_at"),
  note: text("note"),
});

/** Webhook IDs already processed, so Shopify retries are handled once. */
export const processedWebhookTable = sqliteTable("processed_webhook", {
  webhookId: text("webhook_id").primaryKey(),
  topic: text("topic").notNull(),
  shop: text("shop").notNull(),
  processedAt: text("processed_at").notNull(),
});
