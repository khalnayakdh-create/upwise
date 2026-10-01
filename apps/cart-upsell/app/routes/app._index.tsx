import type { Route } from "./+types/app._index";
import type { HeadersFunction } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getDb } from "@upwise/platform";
import { getShopify } from "../shopify.server";
import { resolvePlan, storeHandle, syncAll } from "../lib/admin.server";
import { listOffers, statsByOffer, totals } from "../lib/offers.server";
import { PLAN_COPY, PLAN_LIMITS } from "../lib/plans";

export const EMBED_HANDLE = "storevine-cart-embed";

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  const { env } = context.cloudflare;
  const { admin, session, billing } = await getShopify(env).authenticate.admin(request);
  const db = getDb(env.DB);
  const { plan, changed } = await resolvePlan(billing, env, session.shop);
  // Plan changes alter which offers are live; keep the storefront in sync.
  if (changed) await syncAll(admin, env, session.shop, plan);

  const [offers, stats] = await Promise.all([listOffers(db, session.shop), statsByOffer(db, session.shop)]);
  const sum = totals(stats);
  const active = offers.filter((o) => o.status === "active").length;
  return {
    plan,
    planName: PLAN_COPY[plan].name,
    overLimit: active > PLAN_LIMITS[plan].maxActiveOffers,
    offerCount: offers.length,
    activeCount: active,
    stats: sum,
    embedUrl: `https://admin.shopify.com/store/${storeHandle(session.shop)}/themes/current/editor?context=apps&template=cart&activateAppId=${env.SHOPIFY_API_KEY}/${EMBED_HANDLE}`,
  };
};

function pct(n: number, d: number) {
  return d ? `${((n / d) * 100).toFixed(1)}%` : "–";
}

export default function Dashboard() {
  const { planName, overLimit, offerCount, activeCount, stats, embedUrl } = useLoaderData<typeof loader>();
  const seenOnStore = stats.impressions > 0;

  return (
    <s-page heading="Storevine Cart Upsell">
      <s-button slot="primary-action" variant="primary" href="/app/offers/new">
        Create offer
      </s-button>

      {overLimit ? (
        <s-banner tone="warning" heading="Some offers are paused on your storefront">
          Your {planName} plan shows 1 active offer on your store. Upgrade to Growth to show all {activeCount}.
          <s-button slot="secondary-actions" href="/app/plans">View plans</s-button>
        </s-banner>
      ) : null}

      <s-section heading="Get set up">
        <s-ordered-list>
          <s-list-item>
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text type="strong">Turn on Storevine in your theme</s-text>
              {seenOnStore ? <s-badge tone="success">Done</s-badge> : null}
            </s-stack>
            <s-paragraph>
              Adds the offer widget to your cart drawer and cart page. Opens the theme editor with the Storevine
              switch ready, then click Save.
            </s-paragraph>
            <s-button href={embedUrl} target="_blank">Open theme editor</s-button>
          </s-list-item>
          <s-list-item>
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text type="strong">Create your first offer</s-text>
              {offerCount > 0 ? <s-badge tone="success">Done</s-badge> : null}
            </s-stack>
            <s-paragraph>Choose which products to recommend in the cart.</s-paragraph>
            <s-button href={offerCount > 0 ? "/app/offers" : "/app/offers/new"}>
              {offerCount > 0 ? "Manage offers" : "Create offer"}
            </s-button>
          </s-list-item>
        </s-ordered-list>
      </s-section>

      <s-section heading="Last 30 days">
        <s-grid gridTemplateColumns="repeat(3, 1fr)" gap="base">
          <s-box>
            <s-text color="subdued">Offer views</s-text>
            <s-heading>{stats.impressions.toLocaleString()}</s-heading>
          </s-box>
          <s-box>
            <s-text color="subdued">Added to cart</s-text>
            <s-heading>{stats.adds.toLocaleString()}</s-heading>
          </s-box>
          <s-box>
            <s-text color="subdued">Add rate</s-text>
            <s-heading>{pct(stats.adds, stats.impressions)}</s-heading>
          </s-box>
        </s-grid>
      </s-section>

      <s-section slot="aside" heading="Plan">
        <s-paragraph>
          You're on the <s-text type="strong">{planName}</s-text> plan with {activeCount} active{" "}
          {activeCount === 1 ? "offer" : "offers"}.
        </s-paragraph>
        <s-link href="/app/plans">Compare plans</s-link>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
