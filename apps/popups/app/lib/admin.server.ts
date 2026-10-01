import { getDb, shopTable } from "@upwise/platform";
import { devPlanOverride, gql, setAppDataJson, type GraphqlFn } from "@upwise/shopify-app";
import { getConfig, storefrontConfig } from "./popup.server";
import { GROWTH_PLAN, PLAN_LIMITS, type PlanKey } from "./plans";

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
  await getDb(env.DB)
    .insert(shopTable)
    .values({ shop, installedAt: new Date().toISOString(), plan })
    .onConflictDoUpdate({ target: shopTable.shop, set: { plan } });
  return { plan, subscriptionId: appSubscriptions[0]?.id ?? null };
}

export async function publishConfig(graphql: GraphqlFn, env: Env, shop: string, plan: PlanKey) {
  const config = await getConfig(getDb(env.DB), shop);
  await setAppDataJson(graphql, "upwise_popups", "config", storefrontConfig(config, PLAN_LIMITS[plan].branding));
}

/**
 * Save a sign-up as a Shopify customer subscribed to email marketing
 * (explicit consent given in the pop-up). Never downgrades existing consent.
 * Requires read/write_customers + protected customer data access (email).
 */
export async function subscribeCustomer(graphql: GraphqlFn, email: string, now = new Date()) {
  const consent = {
    marketingState: "SUBSCRIBED",
    marketingOptInLevel: "SINGLE_OPT_IN",
    consentUpdatedAt: now.toISOString(),
  };
  const found = await gql<{
    customers: { nodes: Array<{ id: string; emailMarketingConsent: { marketingState: string } | null }> };
  }>(
    graphql,
    `#graphql
    query UpwiseFindCustomer($query: String!) {
      customers(first: 1, query: $query) { nodes { id emailMarketingConsent { marketingState } } }
    }`,
    { query: `email:${JSON.stringify(email)}` },
  );
  const existing = found.customers.nodes[0];
  if (existing) {
    if (existing.emailMarketingConsent?.marketingState === "SUBSCRIBED") return { status: "already" as const };
    const r = await gql<{ customerEmailMarketingConsentUpdate: { userErrors: Array<{ message: string }> } }>(
      graphql,
      `#graphql
      mutation UpwiseConsent($input: CustomerEmailMarketingConsentUpdateInput!) {
        customerEmailMarketingConsentUpdate(input: $input) { userErrors { message } }
      }`,
      { input: { customerId: existing.id, emailMarketingConsent: consent } },
    );
    const errors = r.customerEmailMarketingConsentUpdate.userErrors;
    if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
    return { status: "updated" as const };
  }
  const created = await gql<{ customerCreate: { userErrors: Array<{ message: string }> } }>(
    graphql,
    `#graphql
    mutation UpwiseCreateCustomer($input: CustomerInput!) {
      customerCreate(input: $input) { customer { id } userErrors { message } }
    }`,
    { input: { email, emailMarketingConsent: consent, tags: ["Upwise pop-up"] } },
  );
  const errors = created.customerCreate.userErrors;
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
  return { status: "created" as const };
}
