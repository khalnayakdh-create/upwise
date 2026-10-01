import { and, eq } from "drizzle-orm";
import { getDb, shopTable, type Db } from "@upwise/platform";
import type { Shopify } from "../shopify.server";
import { buildDiscountConfig, buildStorefrontConfig, listOffers, type OfferProduct } from "./offers.server";
import { PAID_PLANS, PLAN_LIMITS, planFromSubscriptionName, type PlanKey } from "./plans";
import { appSettingTable } from "./schema";

export type AdminContext = Awaited<ReturnType<Shopify["authenticate"]["admin"]>>;

export const CONFIG_NAMESPACE = "storevine_cart";
export const CONFIG_KEY = "config";

/** Snapshot product details needed by the storefront widget. */
export async function fetchOfferProducts(
  admin: AdminContext["admin"],
  ids: string[],
): Promise<{ products: OfferProduct[]; missing: string[] }> {
  if (ids.length === 0) return { products: [], missing: [] };
  const response = await admin.graphql(
    `#graphql
    query OfferProducts($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          handle
          title
          status
          featuredMedia { preview { image { url(transform: { maxWidth: 200 }) } } }
          variants(first: 25) { nodes { id availableForSale } }
        }
      }
    }`,
    { variables: { ids } },
  );
  const { data } = (await response.json()) as {
    data?: {
      nodes: Array<{
        id: string;
        handle: string;
        title: string;
        status: string;
        featuredMedia: { preview: { image: { url: string } | null } | null } | null;
        variants: { nodes: Array<{ id: string; availableForSale: boolean }> };
      } | null>;
    };
  };
  const products: OfferProduct[] = [];
  const missing: string[] = [];
  ids.forEach((id, i) => {
    const node = data?.nodes?.[i];
    if (!node || !node.id) {
      missing.push(id);
      return;
    }
    const variant = node.variants.nodes.find((v) => v.availableForSale) ?? node.variants.nodes[0];
    if (!variant) {
      missing.push(id);
      return;
    }
    products.push({
      productId: node.id,
      variantId: variant.id,
      handle: node.handle,
      title: node.title,
      image: node.featuredMedia?.preview?.image?.url ?? null,
    });
  });
  return { products, missing };
}

export async function getSetting(db: Db, shop: string, key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: appSettingTable.value })
    .from(appSettingTable)
    .where(and(eq(appSettingTable.shop, shop), eq(appSettingTable.key, key)));
  return row?.value ?? null;
}

export async function setSetting(db: Db, shop: string, key: string, value: string) {
  await db
    .insert(appSettingTable)
    .values({ shop, key, value })
    .onConflictDoUpdate({ target: [appSettingTable.shop, appSettingTable.key], set: { value } });
}

type Graphql = AdminContext["admin"]["graphql"];

async function gql<T>(graphql: Graphql, query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await graphql(query, variables ? { variables } : undefined);
  const body = (await response.json()) as { data?: T; errors?: unknown };
  if (!body.data) throw new Error(`GraphQL error: ${JSON.stringify(body.errors)}`);
  return body.data;
}

export const DISCOUNT_FUNCTION_HANDLE = "storevine-cart-discount";
// v2: the Function was renamed (Upwise → Storevine). Discounts tied to the old
// Function stop working, so each shop gets a fresh discount on its next save.
export const DISCOUNT_SETTING = "discount_id_v2";

/**
 * Keep one automatic app discount per shop pointing at the storevine-cart-discount
 * Function, and write the per-offer config into its metafield.
 * Returns a warning string if discounts couldn't be synced (e.g. scope missing).
 */
export async function syncDiscount(
  admin: AdminContext["admin"],
  env: Env,
  shop: string,
  plan: PlanKey,
): Promise<string | null> {
  const db = getDb(env.DB);
  const config = buildDiscountConfig(await listOffers(db, shop), plan);
  const hasDiscounts = Object.keys(config.offers).length > 0;
  let discountId = await getSetting(db, shop, DISCOUNT_SETTING);
  if (!discountId && !hasDiscounts) return null;

  try {
    if (discountId) {
      const check = await gql<{ discountNode: { id: string } | null }>(
        admin.graphql,
        `#graphql
        query StorevineDiscountExists($id: ID!) { discountNode(id: $id) { id } }`,
        { id: discountId },
      );
      if (!check.discountNode) discountId = null; // merchant deleted it
    }
    const value = JSON.stringify(config);
    if (!discountId) {
      const created = await gql<{
        discountAutomaticAppCreate: {
          automaticAppDiscount: { discountId: string } | null;
          userErrors: Array<{ message: string }>;
        };
      }>(
        admin.graphql,
        `#graphql
        mutation StorevineCreateDiscount($discount: DiscountAutomaticAppInput!) {
          discountAutomaticAppCreate(automaticAppDiscount: $discount) {
            automaticAppDiscount { discountId }
            userErrors { message }
          }
        }`,
        {
          discount: {
            title: "Storevine cart offer discounts",
            functionHandle: DISCOUNT_FUNCTION_HANDLE,
            discountClasses: ["PRODUCT"],
            startsAt: new Date().toISOString(),
            combinesWith: { orderDiscounts: true, productDiscounts: false, shippingDiscounts: true },
            metafields: [{ namespace: "$app", key: "function-configuration", type: "json", value }],
          },
        },
      );
      const errors = created.discountAutomaticAppCreate.userErrors;
      const id = created.discountAutomaticAppCreate.automaticAppDiscount?.discountId;
      if (errors.length || !id) return `Couldn't create the discount: ${errors.map((e) => e.message).join("; ")}`;
      await setSetting(db, shop, DISCOUNT_SETTING, id);
      return null;
    }
    const set = await gql<{ metafieldsSet: { userErrors: Array<{ message: string }> } }>(
      admin.graphql,
      `#graphql
      mutation StorevineDiscountConfig($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) { userErrors { message } }
      }`,
      { metafields: [{ ownerId: discountId, namespace: "$app", key: "function-configuration", type: "json", value }] },
    );
    const errors = set.metafieldsSet.userErrors;
    return errors.length ? `Couldn't update the discount: ${errors.map((e) => e.message).join("; ")}` : null;
  } catch (error) {
    console.error("syncDiscount failed", error);
    return "Discounts couldn't be updated. Reopen the app to approve the discount permission, then save again.";
  }
}

export interface ThankYouConfig {
  enabled: boolean;
  heading: string;
  body: string;
  discountCode: string;
  products: Array<{ handle: string; productId: string; title: string; image: string | null }>;
}

export const THANK_YOU_SETTING = "thank_you_config";

export async function getThankYouConfig(db: Db, shop: string): Promise<ThankYouConfig> {
  const raw = await getSetting(db, shop, THANK_YOU_SETTING);
  const fallback: ThankYouConfig = { enabled: false, heading: "", body: "", discountCode: "", products: [] };
  if (!raw) return fallback;
  try {
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

/** Write the thank-you config to a shop metafield ($app namespace) read by the checkout extension. */
export async function syncThankYou(admin: AdminContext["admin"], env: Env, shop: string, plan: PlanKey) {
  const config = await getThankYouConfig(getDb(env.DB), shop);
  const live = { ...config, enabled: config.enabled && PLAN_LIMITS[plan].thankYouOffers };
  const { shop: s } = await gql<{ shop: { id: string } }>(admin.graphql, `#graphql
    query StorevineShopId { shop { id } }`);
  const set = await gql<{ metafieldsSet: { userErrors: Array<{ message: string }> } }>(
    admin.graphql,
    `#graphql
    mutation StorevineThankYouConfig($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { message } }
    }`,
    {
      metafields: [
        {
          ownerId: s.id,
          namespace: "$app",
          key: "thank_you_config",
          type: "json",
          value: JSON.stringify({
            enabled: live.enabled,
            heading: live.heading,
            body: live.body,
            discountCode: live.discountCode,
            products: live.products.map((p) => ({ handle: p.handle })),
          }),
        },
      ],
    },
  );
  const errors = set.metafieldsSet.userErrors;
  if (errors.length) throw new Error(`thank-you metafield: ${errors.map((e) => e.message).join("; ")}`);
}

/** Sync everything that depends on offers/plan. Returns a warning for the UI, if any. */
export async function syncAll(admin: AdminContext["admin"], env: Env, shop: string, plan: PlanKey) {
  await syncStorefrontConfig(admin, env, shop, plan);
  await syncThankYou(admin, env, shop, plan).catch((e) => console.error("syncThankYou failed", e));
  return syncDiscount(admin, env, shop, plan);
}

/** Write the storefront config to an app-owned metafield (read by the theme extension). */
export async function syncStorefrontConfig(admin: AdminContext["admin"], env: Env, shop: string, plan: PlanKey) {
  const offers = await listOffers(getDb(env.DB), shop);
  const config = buildStorefrontConfig(offers, plan);
  const idResponse = await admin.graphql(`#graphql
    query AppInstallationId { currentAppInstallation { id } }`);
  const { data: idData } = (await idResponse.json()) as {
    data?: { currentAppInstallation: { id: string } };
  };
  const ownerId = idData?.currentAppInstallation.id;
  if (!ownerId) throw new Error("Could not resolve app installation id");

  const response = await admin.graphql(
    `#graphql
    mutation SetCartConfig($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [
          { ownerId, namespace: CONFIG_NAMESPACE, key: CONFIG_KEY, type: "json", value: JSON.stringify(config) },
        ],
      },
    },
  );
  const { data } = (await response.json()) as {
    data?: { metafieldsSet: { userErrors: Array<{ field: string[]; message: string }> } };
  };
  const errors = data?.metafieldsSet.userErrors ?? [];
  if (errors.length) throw new Error(`metafieldsSet failed: ${errors.map((e) => e.message).join("; ")}`);
  return config;
}

/** Current plan from Shopify billing; cached on the shop row. Returns [plan, changed]. */
export async function resolvePlan(
  billing: AdminContext["billing"],
  env: Env,
  shop: string,
): Promise<{ plan: PlanKey; changed: boolean; subscriptionId: string | null }> {
  const { hasActivePayment, appSubscriptions } = await billing.check({
    plans: [...PAID_PLANS],
    isTest: env.BILLING_TEST_MODE !== "false",
  });
  let plan: PlanKey = hasActivePayment ? planFromSubscriptionName(appSubscriptions[0]?.name) : "free";
  const override = devPlanOverride(env, shop);
  if (override) plan = override;
  const db = getDb(env.DB);
  const [row] = await db.select({ plan: shopTable.plan }).from(shopTable).where(eq(shopTable.shop, shop));
  const changed = !row || row.plan !== plan;
  if (changed) {
    await db
      .insert(shopTable)
      .values({ shop, installedAt: new Date().toISOString(), plan })
      .onConflictDoUpdate({ target: shopTable.shop, set: { plan } });
  }
  return { plan, changed, subscriptionId: appSubscriptions[0]?.id ?? null };
}

/**
 * Development only: DEV_PLAN_OVERRIDES="shop.myshopify.com:pro,other.myshopify.com:growth"
 * lets named dev stores test paid features without a subscription.
 * MUST be empty in production (checked in docs/launch-checklist.md).
 */
export function devPlanOverride(env: Env, shop: string): PlanKey | null {
  const raw = (env as unknown as { DEV_PLAN_OVERRIDES?: string }).DEV_PLAN_OVERRIDES ?? "";
  for (const entry of raw.split(",")) {
    const [s, p] = entry.trim().split(":");
    if (s === shop && (p === "free" || p === "growth" || p === "pro")) return p;
  }
  return null;
}

export function storeHandle(shop: string) {
  return shop.replace(/\.myshopify\.com$/, "");
}
