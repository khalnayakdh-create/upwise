import { eq } from "drizzle-orm";
import { getDb, shopTable } from "@upwise/platform";
import type { Shopify } from "../shopify.server";
import { buildStorefrontConfig, listOffers, type OfferProduct } from "./offers.server";
import { GROWTH_PLAN, type PlanKey } from "./plans";

export type AdminContext = Awaited<ReturnType<Shopify["authenticate"]["admin"]>>;

export const CONFIG_NAMESPACE = "upwise_cart";
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
    plans: [GROWTH_PLAN],
    isTest: env.BILLING_TEST_MODE !== "false",
  });
  const plan: PlanKey = hasActivePayment ? "growth" : "free";
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

export function storeHandle(shop: string) {
  return shop.replace(/\.myshopify\.com$/, "");
}
