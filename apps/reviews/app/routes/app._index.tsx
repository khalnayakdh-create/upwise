import type { Route } from "./+types/app._index";
import type { HeadersFunction } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getDb } from "@upwise/platform";
import { storeHandle } from "@upwise/shopify-app";
import { getShopify } from "../shopify.server";
import { resolvePlan } from "../lib/admin.server";
import { shopTotals } from "../lib/reviews.server";
import { PLAN_COPY } from "../lib/plans";

export const BLOCK_HANDLE = "product-reviews";

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  const { env } = context.cloudflare;
  const { session, billing } = await getShopify(env).authenticate.admin(request);
  const { plan } = await resolvePlan(billing as never, env, session.shop);
  const totals = await shopTotals(getDb(env.DB), session.shop);
  return {
    planName: PLAN_COPY[plan].name,
    totals,
    addBlockUrl: `https://admin.shopify.com/store/${storeHandle(session.shop)}/themes/current/editor?template=product&addAppBlockId=${env.SHOPIFY_API_KEY}/${BLOCK_HANDLE}&target=mainSection`,
  };
};

export default function Dashboard() {
  const { planName, totals, addBlockUrl } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Storevine Reviews">
      {totals.pending > 0 ? (
        <s-banner tone="info" heading={`${totals.pending} review${totals.pending === 1 ? "" : "s"} waiting for approval`}>
          <s-button slot="secondary-actions" href="/app/reviews?status=pending">Review now</s-button>
        </s-banner>
      ) : null}
      <s-section heading="Get set up">
        <s-ordered-list>
          <s-list-item>
            <s-text type="strong">Add reviews to your product page</s-text>
            <s-paragraph>Opens the theme editor with the Storevine reviews block ready to place, then click Save.</s-paragraph>
            <s-button href={addBlockUrl} target="_blank">Add reviews block</s-button>
          </s-list-item>
          <s-list-item>
            <s-text type="strong">Bring your existing reviews</s-text>
            <s-paragraph>Import a CSV export from another reviews app.</s-paragraph>
            <s-button href="/app/import">Import reviews</s-button>
          </s-list-item>
        </s-ordered-list>
      </s-section>
      <s-section heading="Overview">
        <s-grid gridTemplateColumns="repeat(3, 1fr)" gap="base">
          <s-box>
            <s-text color="subdued">Published reviews</s-text>
            <s-heading>{totals.published.toLocaleString()}</s-heading>
          </s-box>
          <s-box>
            <s-text color="subdued">Average rating</s-text>
            <s-heading>{totals.average ? `${totals.average} ★` : "–"}</s-heading>
          </s-box>
          <s-box>
            <s-text color="subdued">Waiting for approval</s-text>
            <s-heading>{totals.pending.toLocaleString()}</s-heading>
          </s-box>
        </s-grid>
      </s-section>
      <s-section slot="aside" heading="Plan">
        <s-paragraph>
          You're on the <s-text type="strong">{planName}</s-text> plan.
        </s-paragraph>
        <s-link href="/app/plans">Compare plans</s-link>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
