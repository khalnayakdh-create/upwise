import type { Route } from "./+types/app._index";
import type { HeadersFunction } from "react-router";
import { Form, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { HealthBanner } from "@upwise/shopify-app/react";
import { getDb, getHealthState } from "@upwise/platform";
import { getShopify } from "../shopify.server";
import { resolvePlan, storeHandle, syncAll, syncStorefrontConfig } from "../lib/admin.server";
import { listOffers, statsByOffer, totals } from "../lib/offers.server";
import { PLAN_COPY, PLAN_LIMITS } from "../lib/plans";
import { attributionTotals, getHoldoutPercent, liftReport, setHoldoutPercent } from "../lib/attribution.server";

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
  const holdout = await getHoldoutPercent(db, session.shop);
  const [sales, lift] = await Promise.all([
    attributionTotals(db, session.shop),
    holdout > 0 ? liftReport(db, session.shop) : Promise.resolve({ status: "off" as const }),
  ]);
  const active = offers.filter((o) => o.status === "active").length;
  return {
    health: (await getHealthState(context.cloudflare.env.DB as never, session.shop))?.problems ?? [],
    plan,
    planName: PLAN_COPY[plan].name,
    overLimit: active > PLAN_LIMITS[plan].maxActiveOffers,
    offerCount: offers.length,
    activeCount: active,
    stats: sum,
    holdout,
    sales,
    lift,
    hasOrderAccess: (session.scope ?? "").split(",").includes("read_orders"),
    embedUrl: `https://admin.shopify.com/store/${storeHandle(session.shop)}/themes/current/editor?context=apps&template=cart&activateAppId=${env.SHOPIFY_API_KEY}/${EMBED_HANDLE}`,
  };
};

export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const { admin, session, billing } = await getShopify(env).authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") !== "holdout") return { ok: false };
  const db = getDb(env.DB);
  await setHoldoutPercent(db, session.shop, Number(form.get("holdout")));
  const { plan } = await resolvePlan(billing, env, session.shop);
  await syncStorefrontConfig(admin, env, session.shop, plan);
  return { ok: true };
};

function money(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

const signedPct = (f: number) => `${f >= 0 ? "+" : ""}${(f * 100).toFixed(1)}%`;

function pct(n: number, d: number) {
  return d ? `${((n / d) * 100).toFixed(1)}%` : "–";
}

export default function Dashboard() {
  const { health, planName, overLimit, offerCount, activeCount, stats, embedUrl, holdout, sales, lift, hasOrderAccess } =
    useLoaderData<typeof loader>();
  const savingHoldout = useNavigation().formData?.get("intent") === "holdout";
  const seenOnStore = stats.impressions > 0;

  return (
    <s-page heading="Storevine Cart Upsell">
      <HealthBanner problems={health} />
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

      <s-section heading="Sales from offers (last 30 days)">
        {!hasOrderAccess ? (
          <s-banner tone="info" heading="Approve order access to see sales">
            Reopen the app and approve the order permission. Storevine reads orders only to total up offer sales; it stores no customer details.
          </s-banner>
        ) : (
          <s-stack gap="base">
            <s-grid gridTemplateColumns="repeat(2, 1fr)" gap="base">
              <s-box>
                <s-text color="subdued">Orders with an offer item</s-text>
                <s-heading>{sales.orders.toLocaleString()}</s-heading>
              </s-box>
              <s-box>
                <s-text color="subdued">Offer item sales, after refunds</s-text>
                <s-heading>{money(sales.netCents, sales.currency)}</s-heading>
              </s-box>
            </s-grid>
            <s-text color="subdued">
              Counts items added from a Storevine offer, after discounts{sales.refundedCents ? ` and ${money(sales.refundedCents, sales.currency)} in refunds` : " and refunds"}.
              Some of these shoppers might have bought anyway; the lift test below measures what offers really add.
            </s-text>
          </s-stack>
        )}
      </s-section>

      <s-section heading="Measured lift">
        <s-stack gap="base">
          <s-paragraph>
            A small share of shoppers never see offers. Comparing their carts with everyone else's shows how much extra revenue offers really
            bring in, not just how many offer items were bought.
          </s-paragraph>
          {lift.status === "off" ? (
            <s-text color="subdued">The holdout test is off, so lift isn't being measured.</s-text>
          ) : lift.status === "collecting" ? (
            <s-banner tone="info" heading="Collecting data">
              So far (last 30 days): {lift.shown.carts.toLocaleString()} carts and {lift.shown.orders.toLocaleString()} orders saw offers;{" "}
              {lift.holdout.carts.toLocaleString()} carts and {lift.holdout.orders.toLocaleString()} orders didn't. Results appear once each group has at
              least 100 carts and 20 orders.
            </s-banner>
          ) : (
            <s-stack gap="small">
              <s-grid gridTemplateColumns="repeat(3, 1fr)" gap="base">
                <s-box>
                  <s-text color="subdued">Revenue per cart, offers shown</s-text>
                  <s-heading>{money(lift.rpcShown, lift.currency)}</s-heading>
                </s-box>
                <s-box>
                  <s-text color="subdued">Revenue per cart, no offers</s-text>
                  <s-heading>{money(lift.rpcHoldout, lift.currency)}</s-heading>
                </s-box>
                <s-box>
                  <s-text color="subdued">Lift</s-text>
                  <s-heading>{signedPct(lift.lift)}</s-heading>
                </s-box>
              </s-grid>
              <s-text color="subdued">
                Likely range {signedPct(lift.liftLow)} to {signedPct(lift.liftHigh)} (95% confidence).{" "}
                {lift.significant
                  ? lift.lift > 0
                    ? `Offers added about ${money(lift.incrementalCents, lift.currency)} in the last 30 days.`
                    : "Offers are lowering revenue per cart; try different products or a smaller discount."
                  : "The difference isn't clear yet; it firms up as more orders come in."}{" "}
                Revenue is order subtotal after discounts and refunds; carts that didn't buy count as zero.
              </s-text>
            </s-stack>
          )}
          <Form method="post">
            <input type="hidden" name="intent" value="holdout" />
            <s-stack direction="inline" gap="base" alignItems="end">
              <s-select label="Shoppers who don't see offers" name="holdout" value={String(holdout)}>
                <s-option value="0">Off</s-option>
                <s-option value="5">5%</s-option>
                <s-option value="10">10% (recommended)</s-option>
                <s-option value="20">20% (faster results)</s-option>
              </s-select>
              <s-button type="submit" loading={savingHoldout}>Save</s-button>
            </s-stack>
          </Form>
        </s-stack>
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
