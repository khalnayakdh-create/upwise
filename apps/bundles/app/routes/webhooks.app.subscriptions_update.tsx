import type { Route } from "./+types/webhooks.app.subscriptions_update";
import { getDb, shopTable } from "@upwise/platform";
import { devPlanOverride, planFromSubscriptionWebhook } from "@upwise/shopify-app";
import { getShopify } from "../shopify.server";
import { syncAll } from "../lib/admin.server";
import { GROWTH_PLAN, type PlanKey } from "../lib/plans";

/** Plan changed in Shopify billing: update the cached plan and re-sync plan-dependent config. */
export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const { shop, payload, admin } = await getShopify(env).authenticate.webhook(request);
  const plan: PlanKey =
    devPlanOverride(env as never, shop, ["free", "growth"] as const) ??
    planFromSubscriptionWebhook<PlanKey>(payload, { [GROWTH_PLAN]: "growth" }, "free");
  await getDb(env.DB)
    .insert(shopTable)
    .values({ shop, installedAt: new Date().toISOString(), plan })
    .onConflictDoUpdate({ target: shopTable.shop, set: { plan } });
  if (admin) await syncAll(admin.graphql as never, env, shop, plan);
  return new Response();
};
