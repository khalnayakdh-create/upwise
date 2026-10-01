/** Small helpers for Admin GraphQL calls made from app routes. */
export type GraphqlFn = (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;

export async function gql<T>(graphql: GraphqlFn, query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await graphql(query, variables ? { variables } : undefined);
  const body = (await response.json()) as { data?: T; errors?: unknown };
  if (!body.data) throw new Error(`GraphQL error: ${JSON.stringify(body.errors)}`);
  return body.data;
}

export function storeHandle(shop: string) {
  return shop.replace(/\.myshopify\.com$/, "");
}

export function numericId(gid: string): number {
  return Number(gid.split("/").pop());
}

/** Write a JSON app-data metafield (owner = this app's installation); readable in theme extensions as app.metafields.<ns>.<key>. */
export async function setAppDataJson(graphql: GraphqlFn, namespace: string, key: string, value: unknown) {
  const { currentAppInstallation } = await gql<{ currentAppInstallation: { id: string } }>(
    graphql,
    `#graphql
    query StorevineAppInstallation { currentAppInstallation { id } }`,
  );
  const result = await gql<{ metafieldsSet: { userErrors: Array<{ message: string }> } }>(
    graphql,
    `#graphql
    mutation StorevineSetAppData($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { message } }
    }`,
    {
      metafields: [
        { ownerId: currentAppInstallation.id, namespace, key, type: "json", value: JSON.stringify(value) },
      ],
    },
  );
  const errors = result.metafieldsSet.userErrors;
  if (errors.length) throw new Error(`metafieldsSet: ${errors.map((e) => e.message).join("; ")}`);
}

/**
 * Development only: DEV_PLAN_OVERRIDES="shop.myshopify.com:pro,..." lets named dev
 * stores test paid features. MUST be empty in production (docs/launch-checklist.md).
 */
export function devPlanOverride<P extends string>(env: { DEV_PLAN_OVERRIDES?: string }, shop: string, allowed: readonly P[]): P | null {
  for (const entry of (env.DEV_PLAN_OVERRIDES ?? "").split(",")) {
    const [s, p] = entry.trim().split(":");
    if (s === shop && (allowed as readonly string[]).includes(p)) return p as P;
  }
  return null;
}

/**
 * Plan from an app_subscriptions/update webhook payload.
 * `names` maps Shopify billing plan names to app plan keys; inactive statuses mean "free".
 */
export function planFromSubscriptionWebhook<P extends string>(
  payload: unknown,
  names: Record<string, P>,
  free: P,
): P {
  const sub = (payload as { app_subscription?: { name?: string; status?: string } })?.app_subscription;
  if (!sub || String(sub.status).toUpperCase() !== "ACTIVE") return free;
  return names[sub.name ?? ""] ?? free;
}
