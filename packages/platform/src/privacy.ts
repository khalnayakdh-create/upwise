import { eq } from "drizzle-orm";
import type { Db } from "./db";
import {
  complianceLogTable,
  processedWebhookTable,
  sessionTable,
  shopTable,
} from "./schema";

export const COMPLIANCE_TOPICS = [
  "CUSTOMERS_DATA_REQUEST",
  "CUSTOMERS_REDACT",
  "SHOP_REDACT",
] as const;
export type ComplianceTopic = (typeof COMPLIANCE_TOPICS)[number];

/** Normalise "customers/data_request" or "CUSTOMERS_DATA_REQUEST". */
export function normaliseTopic(topic: string): ComplianceTopic | null {
  const upper = topic.replace("/", "_").toUpperCase();
  return (COMPLIANCE_TOPICS as readonly string[]).includes(upper)
    ? (upper as ComplianceTopic)
    : null;
}

/**
 * Per-app hook: each app registers how to delete its own shop-scoped tables
 * and how to export/redact customer data it holds. Apps that store no
 * customer PII (e.g. Cart Upsell) leave the customer hooks empty.
 */
export interface PrivacyHooks {
  purgeShop?: (db: Db, shop: string) => Promise<void>;
  exportCustomer?: (db: Db, shop: string, payload: unknown) => Promise<string>;
  redactCustomer?: (db: Db, shop: string, payload: unknown) => Promise<string>;
}

/** Delete every platform-level row for a shop. Apps add their own via hooks. */
export async function purgeShopPlatformData(db: Db, shop: string) {
  await db.delete(sessionTable).where(eq(sessionTable.shop, shop));
  await db.delete(processedWebhookTable).where(eq(processedWebhookTable.shop, shop));
  await db.delete(shopTable).where(eq(shopTable.shop, shop));
}

export async function handleComplianceWebhook(
  db: Db,
  args: { topic: string; shop: string; webhookId?: string; payload: unknown },
  hooks: PrivacyHooks = {},
  now = () => new Date(),
): Promise<{ topic: ComplianceTopic; note: string }> {
  const topic = normaliseTopic(args.topic);
  if (!topic) throw new Error(`Not a compliance topic: ${args.topic}`);

  const [log] = await db
    .insert(complianceLogTable)
    .values({
      shop: args.shop,
      topic,
      webhookId: args.webhookId ?? null,
      receivedAt: now().toISOString(),
    })
    .returning({ id: complianceLogTable.id });

  let note: string;
  switch (topic) {
    case "SHOP_REDACT": {
      // shop/redact is scheduled 48h after uninstall. If the merchant has
      // reinstalled since, the data now belongs to the active install: keep it.
      const [current] = await db
        .select({ uninstalledAt: shopTable.uninstalledAt })
        .from(shopTable)
        .where(eq(shopTable.shop, args.shop));
      if (current && current.uninstalledAt === null) {
        note = "Shop has reinstalled since uninstalling; active install data kept.";
        break;
      }
      await hooks.purgeShop?.(db, args.shop);
      await purgeShopPlatformData(db, args.shop);
      note = "All shop data deleted.";
      break;
    }
    case "CUSTOMERS_DATA_REQUEST":
      note = hooks.exportCustomer
        ? await hooks.exportCustomer(db, args.shop, args.payload)
        : "App stores no customer personal data; nothing to export.";
      break;
    case "CUSTOMERS_REDACT":
      note = hooks.redactCustomer
        ? await hooks.redactCustomer(db, args.shop, args.payload)
        : "App stores no customer personal data; nothing to redact.";
      break;
  }

  // The compliance log is kept (it holds no PII) as evidence the request was met.
  await db
    .update(complianceLogTable)
    .set({ completedAt: now().toISOString(), note })
    .where(eq(complianceLogTable.id, log.id));

  return { topic, note };
}
