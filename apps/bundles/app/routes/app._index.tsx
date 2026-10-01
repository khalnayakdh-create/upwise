import type { Route } from "./+types/app._index";
import type { HeadersFunction } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getDb } from "@upwise/platform";
import { storeHandle } from "@upwise/shopify-app";
import { getShopify } from "../shopify.server";
import { resolvePlan, syncAll } from "../lib/admin.server";
import { bundleStats, listBundles } from "../lib/bundles.server";
import { PLAN_COPY } from "../lib/plans";

export const BLOCK_HANDLE = "frequently-bought-together";

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  const { env } = context.cloudflare;
  const { admin, session, billing } = await getShopify(env).authenticate.admin(request);
  const db = getDb(env.DB);
  const { plan } = await resolvePlan(billing as never, env, session.shop);
  await syncAll(admin.graphql as never, env, session.shop, plan);
  const [bundles, stats] = await Promise.all([listBundles(db, session.shop), bundleStats(db, session.shop)]);
  let impressions = 0;
  let adds = 0;
  for (const s of stats.values()) { impressions += s.impressions; adds += s.adds; }
  return {
    planName: PLAN_COPY[plan].name,
    bundleCount: bundles.length,
    impressions,
    adds,
    addBlockUrl: `https://admin.shopify.com/store/${storeHandle(session.shop)}/themes/current/editor?template=product&addAppBlockId=${env.SHOPIFY_API_KEY}/${BLOCK_HANDLE}&target=mainSection`,
  };
};

export default function Dashboard() {
  const { planName, bundleCount, impressions, adds, addBlockUrl } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Upwise Bundles">
      <s-button slot="primary-action" variant="primary" href="/app/bundles/new">Create bundle</s-button>
      <s-section heading="Get set up">
        <s-ordered-list>
          <s-list-item>
            <s-text type="strong">Create a bundle</s-text>
            <s-paragraph>Pick 2–5 products that go together and an optional discount for buying them all.</s-paragraph>
            <s-button href={bundleCount ? "/app/bundles" : "/app/bundles/new"}>{bundleCount ? "Manage bundles" : "Create bundle"}</s-button>
          </s-list-item>
          <s-list-item>
            <s-text type="strong">Add the bundle block to your product page</s-text>
            <s-paragraph>Opens the theme editor with the block ready to place; click Save.</s-paragraph>
            <s-button href={addBlockUrl} target="_blank">Add bundle block</s-button>
          </s-list-item>
        </s-ordered-list>
      </s-section>
      <s-section heading="Last 30 days">
        <s-grid gridTemplateColumns="repeat(3, 1fr)" gap="base">
          <s-box><s-text color="subdued">Bundle views</s-text><s-heading>{impressions.toLocaleString()}</s-heading></s-box>
          <s-box><s-text color="subdued">Bundles added</s-text><s-heading>{adds.toLocaleString()}</s-heading></s-box>
          <s-box><s-text color="subdued">Add rate</s-text><s-heading>{impressions ? `${((adds / impressions) * 100).toFixed(1)}%` : "–"}</s-heading></s-box>
        </s-grid>
      </s-section>
      <s-section slot="aside" heading="Plan">
        <s-paragraph>You're on the <s-text type="strong">{planName}</s-text> plan.</s-paragraph>
        <s-link href="/app/plans">Compare plans</s-link>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
