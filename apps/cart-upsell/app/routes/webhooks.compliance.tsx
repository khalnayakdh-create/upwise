import type { Route } from "./+types/webhooks.compliance";
import { getDb, handleComplianceWebhook } from "@upwise/platform";
import { getShopify } from "../shopify.server";

/**
 * Mandatory privacy webhooks: customers/data_request, customers/redact,
 * shop/redact. HMAC is verified by authenticate.webhook (401 if invalid).
 * Cart Upsell stores no customer personal data, so customer requests are
 * logged and acknowledged; shop/redact deletes everything for the shop.
 */
export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const { shop, topic, webhookId, payload } =
    await getShopify(env).authenticate.webhook(request);
  await handleComplianceWebhook(getDb(env.DB), { topic, shop, webhookId, payload });
  return new Response();
};
