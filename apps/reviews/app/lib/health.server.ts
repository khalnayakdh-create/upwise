import { runAppHealthCheck } from "@upwise/shopify-app";
import { getShopify } from "../shopify.server";
import { REVIEW_HEALTH_CAUSES } from "./health-causes";
import { reviewSignals } from "./health-signals";

export function runDailyHealthCheck(env: Env) {
  return runAppHealthCheck({
    d1: env.DB as never,
    appName: "Storevine Reviews",
    appHandle: "upwise-reviews",
    email: (env as unknown as { EMAIL?: never }).EMAIL,
    admin: async (shop) => (await getShopify(env).unauthenticated.admin(shop)).admin.graphql as never,
    signalsFor: (shop) => reviewSignals(env.DB as never, shop),
    causes: REVIEW_HEALTH_CAUSES,
  });
}
