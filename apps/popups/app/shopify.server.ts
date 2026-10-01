import { createShopifyFactory, sharedRoutes, type BaseEnv } from "@upwise/shopify-app";
import { PAID_PLANS } from "./lib/plans";
import { purgePopupsShop } from "./lib/popup.server";

export const getShopify = createShopifyFactory(PAID_PLANS) as unknown as (
  env: Env,
) => ReturnType<ReturnType<typeof createShopifyFactory>>;

export const shared = sharedRoutes(getShopify as (env: BaseEnv) => never, {
  app: "storevine-popups",
  privacy: {
    purgeShop: purgePopupsShop,
    // Sign-ups are stored as Shopify customers, not in Storevine. Shopify handles
    // customer data requests/erasure for its own records; Storevine holds nothing to return.
  },
});
