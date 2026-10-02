import { dropToZeroSignal, signalWindowStart, type HealthSignal } from "@upwise/platform";
import { runAppHealthCheck } from "@upwise/shopify-app";
import { getShopify } from "../shopify.server";

/** Bundle blocks stopped being seen while bundles are active. */
export async function bundleSignals(d1: D1Database, shop: string, now = new Date()): Promise<HealthSignal[]> {
  const active = await d1.prepare("SELECT 1 FROM bundle WHERE shop = ? AND status = 'active' LIMIT 1").bind(shop).first();
  if (!active) return [];
  const { results } = await d1
    .prepare("SELECT day, SUM(impressions) AS n FROM bundle_stat_daily WHERE shop = ? AND day >= ? GROUP BY day")
    .bind(shop, signalWindowStart(now))
    .all<{ day: string; n: number }>();
  return [dropToZeroSignal("views", "bundle views", results, now)];
}

export function runDailyHealthCheck(env: Env) {
  return runAppHealthCheck({
    d1: env.DB as never,
    appName: "Storevine Bundles",
    appHandle: "upwise-bundles",
    email: (env as unknown as { EMAIL?: never }).EMAIL,
    admin: async (shop) => (await getShopify(env).unauthenticated.admin(shop)).admin.graphql as never,
    signalsFor: (shop) => bundleSignals(env.DB, shop),
  });
}
