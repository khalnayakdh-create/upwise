import type { Route } from "./+types/webhooks.orders.fulfilled";
import { claimWebhook, getDb } from "@upwise/platform";
import { getShopify } from "../shopify.server";
import { getSettings } from "../lib/reviews.server";
import { parseOrder, scheduleRequest } from "../lib/requests.server";

/** orders/fulfilled → schedule a review-request email (only when the merchant has turned requests on). */
export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const { shop, topic, webhookId, payload } = await getShopify(env).authenticate.webhook(request);
  const db = getDb(env.DB);
  if (!(await claimWebhook(db, webhookId, topic, shop))) return new Response();
  const settings = await getSettings(db, shop);
  if (!settings.requestsEnabled) return new Response(); // store no customer data unless asked to
  const order = parseOrder(payload);
  if (order) await scheduleRequest(db, shop, order, settings.requestDelayDays);
  return new Response();
};
