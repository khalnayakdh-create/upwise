// Use the Web-standard (Workers) runtime adapter instead of the Node one.
import "@shopify/shopify-api/adapters/cf-worker";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { DrizzleSessionStorageSQLite } from "@shopify/shopify-app-session-storage-drizzle";
import { getDb, sessionTable } from "@upwise/platform";

/** Pinned Admin API version. Upgrade quarterly (blueprint §6.11). */
export const API_VERSION = ApiVersion.July26;

import { GROWTH_PLAN } from "./lib/plans";

function createShopify(env: Env) {
  if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_API_SECRET || !env.SHOPIFY_APP_URL) {
    throw new Error(
      "Missing SHOPIFY_API_KEY, SHOPIFY_API_SECRET or SHOPIFY_APP_URL. Set vars in wrangler.jsonc and the secret in Cloudflare.",
    );
  }
  return shopifyApp({
    apiKey: env.SHOPIFY_API_KEY,
    apiSecretKey: env.SHOPIFY_API_SECRET,
    apiVersion: API_VERSION,
    scopes: env.SCOPES?.split(",").filter(Boolean),
    appUrl: env.SHOPIFY_APP_URL,
    authPathPrefix: "/auth",
    sessionStorage: new DrizzleSessionStorageSQLite(getDb(env.DB), sessionTable),
    distribution: AppDistribution.AppStore,
    future: {
      expiringOfflineAccessTokens: true,
    },
    billing: {
      [GROWTH_PLAN]: {
        trialDays: 7,
        lineItems: [
          {
            amount: 9.99,
            currencyCode: "USD",
            interval: BillingInterval.Every30Days,
          },
        ],
      },
    },
  });
}

export type Shopify = ReturnType<typeof createShopify>;

// One instance per isolate; env is stable for an isolate's lifetime.
let instance: { env: Env; shopify: Shopify } | undefined;

export function getShopify(env: Env): Shopify {
  if (!instance || instance.env !== env) {
    instance = { env, shopify: createShopify(env) };
  }
  return instance.shopify;
}
