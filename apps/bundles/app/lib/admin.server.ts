import { getDb, shopTable } from "@upwise/platform";
import { devPlanOverride, gql, setAppDataJson, type GraphqlFn } from "@upwise/shopify-app";
import { discountConfig, getSetting, hasDiscounts, listBundles, setSetting, storefrontConfig, type BundleProduct } from "./bundles.server";
import { GROWTH_PLAN, type PlanKey } from "./plans";

type Billing = {
  check: (o: { plans: string[]; isTest: boolean }) => Promise<{
    hasActivePayment: boolean;
    appSubscriptions: Array<{ id: string; name: string }>;
  }>;
};

export async function resolvePlan(billing: Billing, env: Env, shop: string) {
  const { hasActivePayment, appSubscriptions } = await billing.check({ plans: [GROWTH_PLAN], isTest: env.BILLING_TEST_MODE !== "false" });
  let plan: PlanKey = hasActivePayment ? "growth" : "free";
  const override = devPlanOverride(env as never, shop, ["free", "growth"] as const);
  if (override) plan = override;
  await getDb(env.DB)
    .insert(shopTable)
    .values({ shop, installedAt: new Date().toISOString(), plan })
    .onConflictDoUpdate({ target: shopTable.shop, set: { plan } });
  return { plan, subscriptionId: appSubscriptions[0]?.id ?? null };
}

export async function fetchProducts(graphql: GraphqlFn, ids: string[]): Promise<{ products: BundleProduct[]; missing: string[] }> {
  if (!ids.length) return { products: [], missing: [] };
  const data = await gql<{
    nodes: Array<{
      id: string;
      handle: string;
      title: string;
      featuredMedia: { preview: { image: { url: string } | null } | null } | null;
      variants: { nodes: Array<{ id: string; availableForSale: boolean }> };
    } | null>;
  }>(
    graphql,
    `#graphql
    query StorevineBundleProducts($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id handle title
          featuredMedia { preview { image { url(transform: { maxWidth: 200 }) } } }
          variants(first: 25) { nodes { id availableForSale } }
        }
      }
    }`,
    { ids },
  );
  const products: BundleProduct[] = [];
  const missing: string[] = [];
  ids.forEach((id, i) => {
    const n = data.nodes[i];
    const v = n?.variants.nodes.find((x) => x.availableForSale) ?? n?.variants.nodes[0];
    if (!n || !v) return missing.push(id);
    products.push({ productId: n.id, variantId: v.id, handle: n.handle, title: n.title, image: n.featuredMedia?.preview?.image?.url ?? null });
  });
  return { products, missing };
}

const FUNCTION_HANDLE = "storevine-bundle-discount";

/** Publish storefront config and keep the automatic discount's config in sync. Returns a warning, if any. */
export async function syncAll(graphql: GraphqlFn, env: Env, shop: string, plan: PlanKey): Promise<string | null> {
  const db = getDb(env.DB);
  const bundles = await listBundles(db, shop);
  await setAppDataJson(graphql, "storevine_bundles", "config", storefrontConfig(bundles, plan));
  const config = discountConfig(bundles, plan);
  let discountId: string | null = await getSetting(db, shop, "discount_id");
  if (!discountId && !hasDiscounts(config)) return null;
  const value = JSON.stringify(config);
  try {
    if (discountId) {
      const check = await gql<{ discountNode: { id: string } | null }>(graphql, `#graphql
        query StorevineBundleDiscount($id: ID!) { discountNode(id: $id) { id } }`, { id: discountId });
      if (!check.discountNode) discountId = null;
    }
    if (!discountId) {
      const created = await gql<{
        discountAutomaticAppCreate: { automaticAppDiscount: { discountId: string } | null; userErrors: Array<{ message: string }> };
      }>(
        graphql,
        `#graphql
        mutation StorevineCreateBundleDiscount($discount: DiscountAutomaticAppInput!) {
          discountAutomaticAppCreate(automaticAppDiscount: $discount) {
            automaticAppDiscount { discountId }
            userErrors { message }
          }
        }`,
        {
          discount: {
            title: "Storevine bundle discounts",
            functionHandle: FUNCTION_HANDLE,
            discountClasses: ["PRODUCT"],
            startsAt: new Date().toISOString(),
            combinesWith: { orderDiscounts: true, productDiscounts: false, shippingDiscounts: true },
            metafields: [{ namespace: "$app", key: "function-configuration", type: "json", value }],
          },
        },
      );
      const id = created.discountAutomaticAppCreate.automaticAppDiscount?.discountId;
      const errors = created.discountAutomaticAppCreate.userErrors;
      if (!id || errors.length) return `Couldn't create the bundle discount: ${errors.map((e) => e.message).join("; ")}`;
      await setSetting(db, shop, "discount_id", id);
      return null;
    }
    const set = await gql<{ metafieldsSet: { userErrors: Array<{ message: string }> } }>(
      graphql,
      `#graphql
      mutation StorevineBundleDiscountConfig($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) { userErrors { message } }
      }`,
      { metafields: [{ ownerId: discountId, namespace: "$app", key: "function-configuration", type: "json", value }] },
    );
    const errors = set.metafieldsSet.userErrors;
    return errors.length ? errors.map((e) => e.message).join("; ") : null;
  } catch (error) {
    console.error("bundle discount sync failed", error);
    return "Bundle discounts couldn't be updated. Reopen the app to approve the discount permission, then save again.";
  }
}
