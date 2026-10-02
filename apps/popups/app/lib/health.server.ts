import { dropToZeroSignal, getDb, signalWindowStart, type HealthSignal } from "@upwise/platform";
import { runAppHealthCheck } from "@upwise/shopify-app";
import { getShopify } from "../shopify.server";
import { getConfig } from "./popup.server";

/** The pop-up stopped showing while it's turned on (embed disabled, theme switched). */
export async function popupSignals(d1: D1Database, shop: string, now = new Date()): Promise<HealthSignal[]> {
  const config = await getConfig(getDb(d1), shop);
  if (!config.enabled) return [];
  const { results } = await d1
    .prepare("SELECT day, impressions AS n FROM popup_stat_daily WHERE shop = ? AND day >= ?")
    .bind(shop, signalWindowStart(now))
    .all<{ day: string; n: number }>();
  return [dropToZeroSignal("views", "pop-up views", results, now)];
}

export function runDailyHealthCheck(env: Env) {
  return runAppHealthCheck({
    d1: env.DB as never,
    appName: "Storevine Pop-ups",
    appHandle: "upwise-pop-ups",
    email: (env as unknown as { EMAIL?: never }).EMAIL,
    admin: async (shop) => (await getShopify(env).unauthenticated.admin(shop)).admin.graphql as never,
    signalsFor: (shop) => popupSignals(env.DB, shop),
  });
}
