import type { Route } from "./+types/app.bundles._index";
import type { HeadersFunction } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getDb } from "@upwise/platform";
import { getShopify } from "../shopify.server";
import { bundleSales, bundleStats, listBundles } from "../lib/bundles.server";

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  const { env } = context.cloudflare;
  const { session } = await getShopify(env).authenticate.admin(request);
  const db = getDb(env.DB);
  const [bundles, stats, sales] = await Promise.all([listBundles(db, session.shop), bundleStats(db, session.shop), bundleSales(db, session.shop)]);
  return {
    bundles: bundles.map((b) => ({
      id: b.id,
      name: b.name,
      status: b.status,
      discount: b.type === "volume" ? b.tiers.map((t) => `${t.min}+: ${t.percent}%`).join(", ") : b.discountPercent ? `${b.discountPercent}%` : "–",
      kind: b.type === "volume" ? (b.products.length === 1 ? "Quantity breaks" : "Mix and match") : "Bought together",
      sales: sales.get(b.id) ?? null,
      products: b.products.map((p) => p.title).join(" + "),
      image: b.products[0]?.image ?? null,
      ...(stats.get(b.id) ?? { impressions: 0, adds: 0 }),
    })),
  };
};

export default function Bundles() {
  const { bundles } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const shopify = useAppBridge();
  const notice = params.get("saved") ? "Bundle saved" : params.get("deleted") ? "Bundle deleted" : null;
  useEffect(() => { if (notice) shopify.toast.show(notice); }, [notice, shopify]);
  return (
    <s-page heading="Bundles">
      <s-button slot="primary-action" variant="primary" href="/app/bundles/new">Create bundle</s-button>
      {bundles.length === 0 ? (
        <s-section>
          <s-empty-state heading="Sell products together">
            <s-paragraph>Show “bought together” sets, quantity breaks (buy 2, save 10%) or mix-and-match offers on product pages, discounted automatically at checkout.</s-paragraph>
            <s-button slot="primary-action" variant="primary" href="/app/bundles/new">Create bundle</s-button>
          </s-empty-state>
        </s-section>
      ) : (
        <s-section padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Bundle</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header format="numeric">Discount</s-table-header>
              <s-table-header format="numeric">Views (30d)</s-table-header>
              <s-table-header format="numeric">Adds (30d)</s-table-header>
              <s-table-header format="numeric">Orders (30d)</s-table-header>
              <s-table-header format="numeric">Revenue (30d)</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {bundles.map((b) => (
                <s-table-row key={b.id} clickDelegate={`bundle-${b.id}`}>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-thumbnail src={b.image ?? undefined} alt="" size="small" />
                      <s-stack gap="none">
                        <s-link id={`bundle-${b.id}`} href={`/app/bundles/${b.id}`}>{b.name}</s-link>
                        <s-text color="subdued">{b.kind} · {b.products}</s-text>
                      </s-stack>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{b.status === "active" ? <s-badge tone="success">Active</s-badge> : <s-badge>Paused</s-badge>}</s-table-cell>
                  <s-table-cell>{b.discount}</s-table-cell>
                  <s-table-cell>{b.impressions.toLocaleString()}</s-table-cell>
                  <s-table-cell>{b.adds.toLocaleString()}</s-table-cell>
                  <s-table-cell>{b.sales ? b.sales.orders.toLocaleString() : "0"}</s-table-cell>
                  <s-table-cell>
                    {b.sales ? new Intl.NumberFormat(undefined, { style: "currency", currency: b.sales.currency }).format(b.sales.revenueCents / 100) : "–"}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
          <s-box padding="base">
            <s-text color="subdued">Orders and revenue count items added from the bundle block, after bundle discounts and before refunds.</s-text>
          </s-box>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
