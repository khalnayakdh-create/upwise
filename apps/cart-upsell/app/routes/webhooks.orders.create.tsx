import type { Route } from "./+types/webhooks.orders.create";
import { claimWebhook, getDb } from "@upwise/platform";
import { getShopify } from "../shopify.server";
import { listOffers } from "../lib/offers.server";
import { parseOrder, recordOrder } from "../lib/attribution.server";

/** orders/create → offer lines (tagged _storevine_offer) and holdout-group order value. No customer data kept. */
export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const { shop, topic, webhookId, payload } = await getShopify(env).authenticate.webhook(request);
  const db = getDb(env.DB);
  if (!(await claimWebhook(db, webhookId, topic, shop))) return new Response();
  const parsed = parseOrder(payload);
  if (parsed.offers.size || parsed.group) {
    const known = new Set((await listOffers(db, shop)).map((o) => o.id));
    await recordOrder(db, shop, parsed, known);
  }
  return new Response();
};
