import { createShopifyFactory, sharedRoutes, type BaseEnv } from "@upwise/shopify-app";
import { PAID_PLANS } from "./lib/plans";
import { purgeReviewsShop } from "./lib/reviews.server";

export const getShopify = createShopifyFactory(PAID_PLANS) as unknown as (
  env: Env,
) => ReturnType<ReturnType<typeof createShopifyFactory>>;

export const shared = sharedRoutes(getShopify as (env: BaseEnv) => never, {
  app: "upwise-reviews",
  privacy: { purgeShop: purgeReviewsShop },
});
