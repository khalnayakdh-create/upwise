import { createShopifyFactory, sharedRoutes, type BaseEnv } from "@upwise/shopify-app";
import { PAID_PLANS } from "./lib/plans";
import { purgeReviewsShop } from "./lib/reviews.server";
import { exportCustomerRequests, purgeRequestsShop, redactCustomerRequests } from "./lib/requests.server";

export const getShopify = createShopifyFactory(PAID_PLANS) as unknown as (
  env: Env,
) => ReturnType<ReturnType<typeof createShopifyFactory>>;

export const shared = sharedRoutes(getShopify as (env: BaseEnv) => never, {
  app: "storevine-reviews",
  privacy: {
    purgeShop: async (db, shop) => {
      await purgeReviewsShop(db, shop);
      await purgeRequestsShop(db, shop);
    },
    exportCustomer: exportCustomerRequests,
    redactCustomer: redactCustomerRequests,
  },
});
