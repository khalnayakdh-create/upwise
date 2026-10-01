import type { Route } from "./+types/webhooks.app.uninstalled";
import { claimWebhook, getDb, recordUninstall } from "@upwise/platform";
import { getShopify } from "../shopify.server";

export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  // Verifies the HMAC; throws a 401 Response if invalid.
  const { shop, topic, webhookId } = await getShopify(env).authenticate.webhook(request);
  const db = getDb(env.DB);
  if (await claimWebhook(db, webhookId, topic, shop)) {
    await recordUninstall(db, shop);
  }
  return new Response();
};
