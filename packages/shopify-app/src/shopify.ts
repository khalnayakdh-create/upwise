// Web-standard (Workers) runtime adapter for the Shopify API library.
import "@shopify/shopify-api/adapters/cf-worker";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { DrizzleSessionStorageSQLite } from "@shopify/shopify-app-session-storage-drizzle";
import type { D1Database } from "@cloudflare/workers-types";
import { getDb, sessionTable } from "@upwise/platform";

/** Pinned Admin API version for all Storevine apps. Upgrade quarterly (blueprint §6.11). */
export const API_VERSION = ApiVersion.July26;

/** Bindings every Storevine app Worker has. */
export interface BaseEnv {
  DB: D1Database;
  SHOPIFY_API_KEY: string;
  SHOPIFY_API_SECRET: string;
  SHOPIFY_APP_URL: string;
  SCOPES: string;
  BILLING_TEST_MODE?: string;
}

export interface PaidPlan {
  name: string;
  amount: number;
  trialDays?: number;
}

function create(env: BaseEnv, plans: PaidPlan[]) {
  if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_API_SECRET || !env.SHOPIFY_APP_URL) {
    throw new Error("Missing SHOPIFY_API_KEY, SHOPIFY_API_SECRET or SHOPIFY_APP_URL.");
  }
  const billing = Object.fromEntries(
    plans.map((p) => [
      p.name,
      {
        trialDays: p.trialDays ?? 7,
        lineItems: [{ amount: p.amount, currencyCode: "USD", interval: BillingInterval.Every30Days }],
      },
    ]),
  );
  return shopifyApp({
    apiKey: env.SHOPIFY_API_KEY,
    apiSecretKey: env.SHOPIFY_API_SECRET,
    apiVersion: API_VERSION,
    scopes: env.SCOPES?.split(",").filter(Boolean),
    appUrl: env.SHOPIFY_APP_URL,
    authPathPrefix: "/auth",
    // The Drizzle adapter's generics don't line up with D1's driver type; runtime shape is identical.
    sessionStorage: new DrizzleSessionStorageSQLite(getDb(env.DB as never) as never, sessionTable as never),
    distribution: AppDistribution.AppStore,
    future: { expiringOfflineAccessTokens: true },
    billing: billing as never,
  });
}

export type StorevineShopify = ReturnType<typeof create>;

/** One Shopify app instance per isolate (env is stable for an isolate). */
export function createShopifyFactory(plans: PaidPlan[] = []) {
  let cached: { env: BaseEnv; shopify: StorevineShopify } | undefined;
  return function getShopify(env: BaseEnv): StorevineShopify {
    if (!cached || cached.env !== env) cached = { env, shopify: create(env, plans) };
    return cached.shopify;
  };
}
