import type { Route } from "./+types/app.offers._index";
import type { HeadersFunction } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getDb, shopTable } from "@upwise/platform";
import { eq } from "drizzle-orm";
import { getShopify } from "../shopify.server";
import { listOffers, statsByOffer } from "../lib/offers.server";
import { PLAN_LIMITS, type PlanKey } from "../lib/plans";

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  const { env } = context.cloudflare;
  const { session } = await getShopify(env).authenticate.admin(request);
  const db = getDb(env.DB);
  const [offers, stats, [shopRow]] = await Promise.all([
    listOffers(db, session.shop),
    statsByOffer(db, session.shop),
    db.select({ plan: shopTable.plan }).from(shopTable).where(eq(shopTable.shop, session.shop)),
  ]);
  const plan = (shopRow?.plan as PlanKey) ?? "free";
  const limit = PLAN_LIMITS[plan].maxActiveOffers;
  let liveSlots = limit;
  return {
    plan,
    offers: offers.map((o) => {
      const live = o.status === "active" && liveSlots-- > 0;
      const s = stats.get(o.id) ?? { impressions: 0, clicks: 0, adds: 0 };
      return {
        id: o.id,
        name: o.name,
        status: o.status,
        live,
        trigger: o.triggerType === "all" ? "Any cart" : `${o.triggerProductIds.length} trigger product(s)`,
        products: o.offerProducts.map((p) => p.title).join(", "),
        image: o.offerProducts[0]?.image ?? null,
        ...s,
      };
    }),
  };
};

export default function Offers() {
  const { offers } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const shopify = useAppBridge();
  const notice = params.get("saved") ? "Offer saved" : params.get("deleted") ? "Offer deleted" : null;

  useEffect(() => {
    if (notice) shopify.toast.show(notice);
  }, [notice, shopify]);

  return (
    <s-page heading="Offers">
      <s-button slot="primary-action" variant="primary" href="/app/offers/new">
        Create offer
      </s-button>
      {offers.length === 0 ? (
        <s-section>
          <s-empty-state heading="Recommend products in the cart">
            <s-paragraph>
              Show shoppers a few products that go well with what's in their cart. Most stores start with one
              offer for any cart.
            </s-paragraph>
            <s-button slot="primary-action" variant="primary" href="/app/offers/new">
              Create offer
            </s-button>
          </s-empty-state>
        </s-section>
      ) : (
        <s-section padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Offer</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Shown when</s-table-header>
              <s-table-header format="numeric">Views (30d)</s-table-header>
              <s-table-header format="numeric">Adds (30d)</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {offers.map((o) => (
                <s-table-row key={o.id} clickDelegate={`offer-link-${o.id}`}>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-thumbnail src={o.image ?? undefined} alt="" size="small" />
                      <s-stack gap="none">
                        <s-link id={`offer-link-${o.id}`} href={`/app/offers/${o.id}`}>
                          {o.name}
                        </s-link>
                        <s-text color="subdued">{o.products}</s-text>
                      </s-stack>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    {o.status === "paused" ? (
                      <s-badge>Paused</s-badge>
                    ) : o.live ? (
                      <s-badge tone="success">Live</s-badge>
                    ) : (
                      <s-badge tone="warning">Over plan limit</s-badge>
                    )}
                  </s-table-cell>
                  <s-table-cell>{o.trigger}</s-table-cell>
                  <s-table-cell>{o.impressions.toLocaleString()}</s-table-cell>
                  <s-table-cell>{o.adds.toLocaleString()}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
