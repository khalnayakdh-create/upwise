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
  const parsed = parseRefund(payload);
  // Shape only (no customer data), so attribution gaps can be diagnosed.
  console.log("refund", JSON.stringify({ lines: parsed.lines, offers: parsed.byOffer.size, totalCents: parsed.totalCents, transactionCents: parsed.transactionCents }));
  await recordRefund(db, shop, parsed);
  return new Response();
};
