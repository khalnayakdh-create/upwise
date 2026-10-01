import { eq } from "drizzle-orm";
import type { Db } from "./db";
import { processedWebhookTable, sessionTable, shopTable } from "./schema";

export async function recordInstall(db: Db, shop: string, now = new Date()) {
  await db
    .insert(shopTable)
    .values({ shop, installedAt: now.toISOString() })
    .onConflictDoUpdate({
      target: shopTable.shop,
      set: { uninstalledAt: null },
    });
}

export async function recordUninstall(db: Db, shop: string, now = new Date()) {
  await db.delete(sessionTable).where(eq(sessionTable.shop, shop));
  await db
    .update(shopTable)
    .set({ uninstalledAt: now.toISOString() })
    .where(eq(shopTable.shop, shop));
}

/**
 * Mark a webhook as processed. Returns false if it was already processed
 * (Shopify retries deliveries), so callers can skip duplicate work.
 */
export async function claimWebhook(
  db: Db,
  webhookId: string | undefined,
  topic: string,
  shop: string,
  now = new Date(),
): Promise<boolean> {
  if (!webhookId) return true;
  const inserted = await db
    .insert(processedWebhookTable)
    .values({ webhookId, topic, shop, processedAt: now.toISOString() })
    .onConflictDoNothing()
    .returning({ id: processedWebhookTable.webhookId });
  return inserted.length > 0;
}
