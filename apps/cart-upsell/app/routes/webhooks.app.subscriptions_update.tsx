import type { Route } from "./+types/webhooks.app.subscriptions_update";
import { getDb, shopTable } from "@upwise/platform";
import { planFromSubscriptionWebhook } from "@upwise/shopify-app";
import { getShopify } from "../shopify.server";
import { devPlanOverride, syncAll } from "../lib/admin.server";
import { GROWTH_PLAN, PRO_PLAN, type PlanKey } from "../lib/plans";

/** Plan changed in Shopify billing: update the cached plan and re-sync offers, discounts and thank-you config. */
export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const { shop, payload, admin } = await getShopify(env).authenticate.webhook(request);
  const plan: PlanKey =
    devPlanOverride(env, shop) ??
    planFromSubscriptionWebhook<PlanKey>(payload, { [GROWTH_PLAN]: "growth", [PRO_PLAN]: "pro" }, "free");
  await getDb(env.DB)
    .insert(shopTable)
    .values({ shop, installedAt: new Date().toISOString(), plan })
    .onConflictDoUpdate({ target: shopTable.shop, set: { plan } });
  if (admin) await syncAll(admin as never, env, shop, plan);
  return new Response();
};
