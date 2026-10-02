import type { Route } from "./+types/webhooks.refunds.create";
import { claimWebhook, getDb } from "@upwise/platform";
import { getShopify } from "../shopify.server";
import { parseRefund, recordRefund } from "../lib/attribution.server";

/** refunds/create → subtract refunded amounts so reported revenue is net of refunds. */
export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const { shop, topic, webhookId, payload } = await getShopify(env).authenticate.webhook(request);
  const db = getDb(env.DB);
  if (!(await claimWebhook(db, webhookId, topic, shop))) return new Response();
  await recordRefund(db, shop, parseRefund(payload));
  return new Response();
};
