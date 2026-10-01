import { eq } from "drizzle-orm";
import { getDb, shopTable } from "@upwise/platform";
import { gql, type GraphqlFn } from "@upwise/shopify-app";
import { getShopify } from "../shopify.server";
import { getSettings } from "./reviews.server";
import { PLAN_LIMITS } from "./plans";
import { processDueRequests, type EmailProduct, type SendDeps } from "./requests.server";

/** Wire processDueRequests to real Shopify + Cloudflare dependencies (used by the cron trigger). */
export function sendDeps(env: Env): SendDeps {
  const db = getDb(env.DB);
  return {
    db,
    secret: env.SHOPIFY_API_SECRET,
    appUrl: env.SHOPIFY_APP_URL,
    email: (env as unknown as { EMAIL?: SendDeps["email"] }).EMAIL,
    async shopContext(shop) {
      const [row] = await db.select().from(shopTable).where(eq(shopTable.shop, shop));
      if (!row || row.uninstalledAt) return null;
      const settings = await getSettings(db, shop);
      const plan = row.plan === "growth" ? "growth" : "free";
      let graphql: GraphqlFn;
      try {
        const { admin } = await getShopify(env).unauthenticated.admin(shop);
        graphql = admin.graphql as never;
      } catch {
        return null; // no offline session (uninstalled)
      }
      const info = await gql<{ shop: { name: string; email: string; contactEmail: string | null; primaryDomain: { url: string } } }>(
        graphql,
        `#graphql
        query StorevineShopForEmail { shop { name email contactEmail primaryDomain { url } } }`,
      );
      return {
        enabled: settings.requestsEnabled,
        monthlyLimit: PLAN_LIMITS[plan].requestsPerMonth,
        shopName: info.shop.name,
        replyTo: info.shop.contactEmail || info.shop.email || null,
        storefrontUrl: info.shop.primaryDomain.url,
        async products(ids: string[]): Promise<EmailProduct[]> {
          const data = await gql<{
            nodes: Array<{ id: string; title: string; status: string; featuredMedia: { preview: { image: { url: string } | null } | null } | null } | null>;
          }>(
            graphql,
            `#graphql
            query StorevineEmailProducts($ids: [ID!]!) {
              nodes(ids: $ids) {
                ... on Product { id title status featuredMedia { preview { image { url(transform: { maxWidth: 144, maxHeight: 144 }) } } } }
              }
            }`,
            { ids },
          );
          return data.nodes
            .filter((p): p is NonNullable<typeof p> => Boolean(p && p.status === "ACTIVE"))
            .map((p) => ({
              numericId: p.id.split("/").pop()!,
              title: p.title,
              imageUrl: p.featuredMedia?.preview?.image?.url ?? null,
            }));
        },
      };
    },
  };
}

export async function runScheduledSends(env: Env) {
  const counts = await processDueRequests(sendDeps(env));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total) console.log("review requests processed", JSON.stringify(counts));
  return counts;
}
