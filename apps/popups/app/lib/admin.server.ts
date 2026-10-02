import { and, eq } from "drizzle-orm";
import { getDb, shopTable } from "@upwise/platform";
import { appSettingTable } from "./schema";
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
  const db = getDb(env.DB);
  const config = await getConfig(db, shop);
  await setAppDataJson(graphql, "storevine_popups", "config", storefrontConfig(config, PLAN_LIMITS[plan].branding));
  await ensureConsentDefinition(graphql, db, shop).catch((e) => console.error("consent definition failed", e instanceof Error ? e.message : e));
}

/**
 * Create a pinned "Pop-up consent" customer metafield definition once, so the
 * consent record shows on each customer's page in the Shopify admin.
 */
export async function ensureConsentDefinition(graphql: GraphqlFn, db: ReturnType<typeof getDb>, shop: string) {
  const [done] = await db
    .select({ value: appSettingTable.value })
    .from(appSettingTable)
    .where(and(eq(appSettingTable.shop, shop), eq(appSettingTable.key, "consent_definition")));
  if (done) return;
  const r = await gql<{ metafieldDefinitionCreate: { userErrors: Array<{ code: string | null; message: string }> } }>(
    graphql,
    `#graphql
    mutation StorevineConsentDefinition($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) { createdDefinition { id } userErrors { code message } }
    }`,
    {
      definition: {
        name: "Pop-up consent",
        namespace: "storevine",
        key: "popup_consent",
        type: "json",
        ownerType: "CUSTOMER",
        description: "What the customer agreed to in the Storevine pop-up, on which page and when.",
        pin: true,
      },
    },
  );
  const errors = r.metafieldDefinitionCreate.userErrors.filter((e) => e.code !== "TAKEN");
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
  await db.insert(appSettingTable).values({ shop, key: "consent_definition", value: "1" }).onConflictDoNothing();
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
    query StorevineFindCustomer($query: String!) {
      customers(first: 1, query: $query) { nodes { id emailMarketingConsent { marketingState } } }
    }`,
    { query: `email:${JSON.stringify(email)}` },
  );
  const existing = found.customers.nodes[0];
  if (existing) {
    const state = existing.emailMarketingConsent?.marketingState;
    if (state === "SUBSCRIBED") return { status: "already" as const, customerId: existing.id };
    // Respect an earlier unsubscribe: a pop-up form can't prove the address owner is opting back in.
    if (state === "UNSUBSCRIBED" || state === "REDACTED") return { status: "skipped" as const, customerId: existing.id };
    const r = await gql<{ customerEmailMarketingConsentUpdate: { userErrors: Array<{ message: string }> } }>(
      graphql,
      `#graphql
      mutation StorevineConsent($input: CustomerEmailMarketingConsentUpdateInput!) {
        customerEmailMarketingConsentUpdate(input: $input) { userErrors { message } }
      }`,
      { input: { customerId: existing.id, emailMarketingConsent: consent } },
    );
    const errors = r.customerEmailMarketingConsentUpdate.userErrors;
    if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
    return { status: "updated" as const, customerId: existing.id };
  }
  const created = await gql<{ customerCreate: { customer: { id: string } | null; userErrors: Array<{ message: string }> } }>(
    graphql,
    `#graphql
    mutation StorevineCreateCustomer($input: CustomerInput!) {
      customerCreate(input: $input) { customer { id } userErrors { message } }
    }`,
    { input: { email, emailMarketingConsent: consent, tags: ["Storevine pop-up"] } },
  );
  const errors = created.customerCreate.userErrors;
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
  return { status: "created" as const, customerId: created.customerCreate.customer?.id ?? null };
}

export interface ConsentRecord {
  /** The exact consent text the shopper ticked. */
  text: string;
  /** Storefront page path the pop-up was on (no query string). */
  page: string;
  at: string;
  source: "Storevine pop-up";
  optInLevel: "SINGLE_OPT_IN";
}

/**
 * Keep proof of consent on the Shopify customer (metafield storevine.popup_consent),
 * so it lives with the merchant's customer record rather than in Storevine.
 */
export async function writeConsentRecord(graphql: GraphqlFn, customerId: string, record: ConsentRecord) {
  const r = await gql<{ metafieldsSet: { userErrors: Array<{ message: string }> } }>(
    graphql,
    `#graphql
    mutation StorevineConsentRecord($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { message } }
    }`,
    { metafields: [{ ownerId: customerId, namespace: "storevine", key: "popup_consent", type: "json", value: JSON.stringify(record) }] },
  );
  const errors = r.metafieldsSet.userErrors;
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
}

/** A single-use code for one customer (needs write_discounts). */
export async function createUniqueCode(
  graphql: GraphqlFn,
  args: { code: string; customerId: string; percent: number; days: number; now?: Date },
) {
  const now = args.now ?? new Date();
  const r = await gql<{ discountCodeBasicCreate: { codeDiscountNode: { id: string } | null; userErrors: Array<{ message: string }> } }>(
    graphql,
    `#graphql
    mutation StorevineWelcomeCode($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) { codeDiscountNode { id } userErrors { message } }
    }`,
    {
      basicCodeDiscount: {
        title: `Storevine pop-up welcome ${args.percent}%`,
        code: args.code,
        startsAt: now.toISOString(),
        endsAt: new Date(now.getTime() + args.days * 86_400_000).toISOString(),
        customerGets: { value: { percentage: args.percent / 100 }, items: { all: true } },
        context: { customers: { add: [args.customerId] } },
        usageLimit: 1,
        appliesOncePerCustomer: true,
        tags: ["Storevine pop-up"],
      },
    },
  );
  const errors = r.discountCodeBasicCreate.userErrors;
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
  return args.code;
}
