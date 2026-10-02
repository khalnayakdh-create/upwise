import type { Route } from "./+types/webhooks.orders.create";
import { claimWebhook, getDb } from "@upwise/platform";
import { getShopify } from "../shopify.server";
import { listBundles, parseBundleOrder, recordBundleOrder } from "../lib/bundles.server";

/** orders/create → record bundle lines (tagged _storevine_bundle by the storefront block) for the sales report. */
export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const { shop, topic, webhookId, payload } = await getShopify(env).authenticate.webhook(request);
  const db = getDb(env.DB);
  if (!(await claimWebhook(db, webhookId, topic, shop))) return new Response();
  const parsed = parseBundleOrder(payload);
  if (parsed.rows.size) {
    const known = new Set((await listBundles(db, shop)).map((b) => b.id));
    await recordBundleOrder(db, shop, parsed, known);
  }
  return new Response();
};
