import type { Route } from "./+types/app._index";
import type { HeadersFunction } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getDb } from "@upwise/platform";
import { storeHandle } from "@upwise/shopify-app";
import { getShopify } from "../shopify.server";
import { publishConfig, resolvePlan } from "../lib/admin.server";
import { getConfig, signupsThisMonth, stats } from "../lib/popup.server";
import { PLAN_COPY, PLAN_LIMITS } from "../lib/plans";

export const EMBED_HANDLE = "storevine-popup-embed";

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  const { env } = context.cloudflare;
  const { admin, session, billing } = await getShopify(env).authenticate.admin(request);
  const db = getDb(env.DB);
  const { plan } = await resolvePlan(billing as never, env, session.shop);
  await publishConfig(admin.graphql as never, env, session.shop, plan); // keeps branding in sync with plan
  const [config, s, month] = await Promise.all([getConfig(db, session.shop), stats(db, session.shop), signupsThisMonth(db, session.shop)]);
  const limit = PLAN_LIMITS[plan].signupsPerMonth;
  return {
    planName: PLAN_COPY[plan].name,
    enabled: config.enabled,
    stats: s,
    month,
    limit: Number.isFinite(limit) ? limit : null,
    embedUrl: `https://admin.shopify.com/store/${storeHandle(session.shop)}/themes/current/editor?context=apps&activateAppId=${env.SHOPIFY_API_KEY}/${EMBED_HANDLE}`,
  };
};

export default function Dashboard() {
  const { planName, enabled, stats, month, limit, embedUrl } = useLoaderData<typeof loader>();
  const rate = stats.impressions ? `${((stats.signups / stats.impressions) * 100).toFixed(1)}%` : "–";
  return (
    <s-page heading="Storevine Pop-ups">
      {limit !== null && month >= limit ? (
        <s-banner tone="warning" heading="You've reached this month's sign-up limit">
          The pop-up is paused until next month. Upgrade for unlimited sign-ups.
          <s-button slot="secondary-actions" href="/app/plans">View plans</s-button>
        </s-banner>
      ) : null}
      <s-section heading="Get set up">
        <s-ordered-list>
          <s-list-item>
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text type="strong">Design your pop-up</s-text>
              {enabled ? <s-badge tone="success">On</s-badge> : <s-badge>Off</s-badge>}
            </s-stack>
            <s-paragraph>Write the offer, choose when it appears, then turn it on.</s-paragraph>
            <s-button href="/app/popup">Edit pop-up</s-button>
          </s-list-item>
          <s-list-item>
            <s-text type="strong">Turn on Storevine Pop-ups in your theme</s-text>
            <s-paragraph>Opens the theme editor with the switch ready; click Save.</s-paragraph>
            <s-button href={embedUrl} target="_blank">Open theme editor</s-button>
          </s-list-item>
        </s-ordered-list>
      </s-section>
      <s-section heading="Last 30 days">
        <s-grid gridTemplateColumns="repeat(3, 1fr)" gap="base">
          <s-box><s-text color="subdued">Pop-up views</s-text><s-heading>{stats.impressions.toLocaleString()}</s-heading></s-box>
          <s-box><s-text color="subdued">Sign-ups</s-text><s-heading>{stats.signups.toLocaleString()}</s-heading></s-box>
          <s-box><s-text color="subdued">Sign-up rate</s-text><s-heading>{rate}</s-heading></s-box>
        </s-grid>
      </s-section>
      <s-section slot="aside" heading="Plan">
        <s-paragraph>
          {planName} plan{limit !== null ? ` · ${month}/${limit} sign-ups this month` : " · unlimited sign-ups"}
        </s-paragraph>
        <s-link href="/app/plans">Compare plans</s-link>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
