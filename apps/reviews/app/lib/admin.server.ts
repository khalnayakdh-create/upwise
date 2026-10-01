import { eq } from "drizzle-orm";
import { getDb, shopTable } from "@upwise/platform";
import { devPlanOverride, gql, type GraphqlFn } from "@upwise/shopify-app";
import { productSummary } from "./reviews.server";
import { GROWTH_PLAN, type PlanKey } from "./plans";

type Billing = {
  check: (o: { plans: string[]; isTest: boolean }) => Promise<{
    hasActivePayment: boolean;
    appSubscriptions: Array<{ id: string; name: string }>;
  }>;
};

export async function resolvePlan(billing: Billing, env: Env, shop: string) {
  const { hasActivePayment, appSubscriptions } = await billing.check({
    plans: [GROWTH_PLAN],
    isTest: env.BILLING_TEST_MODE !== "false",
  });
  let plan: PlanKey = hasActivePayment ? "growth" : "free";
  const override = devPlanOverride(env as never, shop, ["free", "growth"] as const);
  if (override) plan = override;
  const db = getDb(env.DB);
  await db
    .insert(shopTable)
    .values({ shop, installedAt: new Date().toISOString(), plan })
    .onConflictDoUpdate({ target: shopTable.shop, set: { plan } });
  return { plan, subscriptionId: appSubscriptions[0]?.id ?? null };
}

/**
 * Write Shopify's standard review metafields on the product so themes,
 * collection pages and Google Shopping can show stars without our script.
 */
export async function syncProductRating(graphql: GraphqlFn, env: Env, shop: string, productId: string) {
  const s = await productSummary(getDb(env.DB), shop, productId);
  const metafields = [
    {
      ownerId: productId,
      namespace: "reviews",
      key: "rating",
      type: "rating",
      value: JSON.stringify({ value: s.count ? s.average.toFixed(1) : "0.0", scale_min: "1.0", scale_max: "5.0" }),
    },
    { ownerId: productId, namespace: "reviews", key: "rating_count", type: "number_integer", value: String(s.count) },
  ];
  // A rating of 0 is outside the 1-5 scale; when there are no reviews, write only the count.
  const payload = s.count ? metafields : metafields.slice(1);
  const result = await gql<{ metafieldsSet: { userErrors: Array<{ message: string }> } }>(
    graphql,
    `#graphql
    mutation UpwiseRating($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { message } }
    }`,
    { metafields: payload },
  );
  const errors = result.metafieldsSet.userErrors;
  if (errors.length) console.error("rating metafields", errors);
}

/** Resolve product handles to ids/titles (for CSV import). */
export async function productsByHandle(graphql: GraphqlFn, handles: string[]) {
  const unique = [...new Set(handles)].slice(0, 1000);
  const found = new Map<string, { id: string; title: string }>();
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const query = batch.map((h) => `handle:${JSON.stringify(h)}`).join(" OR ");
    const data = await gql<{ products: { nodes: Array<{ id: string; handle: string; title: string }> } }>(
      graphql,
      `#graphql
      query UpwiseProductsByHandle($query: String!) {
        products(first: 50, query: $query) { nodes { id handle title } }
      }`,
      { query },
    );
    for (const p of data.products.nodes) found.set(p.handle, { id: p.id, title: p.title });
  }
  return found;
}

export async function productInfo(graphql: GraphqlFn, productId: string) {
  const data = await gql<{ product: { handle: string; title: string } | null }>(
    graphql,
    `#graphql
    query UpwiseProduct($id: ID!) { product(id: $id) { handle title } }`,
    { id: productId },
  );
  return data.product;
}

export { eq };
