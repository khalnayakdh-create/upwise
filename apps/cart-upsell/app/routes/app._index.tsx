import type { Route } from "./+types/app._index";
import type { HeadersFunction } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getShopify, GROWTH_PLAN } from "../shopify.server";

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  const shopify = getShopify(context.cloudflare.env);
  const { admin, session, billing } = await shopify.authenticate.admin(request);

  // Spike check 1: an Admin GraphQL call works from the Worker.
  const response = await admin.graphql(
    `#graphql
    query ShopInfo {
      shop { name plan { publicDisplayName partnerDevelopment } }
      productsCount { count }
    }`,
  );
  const { data } = await response.json();

  // Spike check 2: billing status can be read.
  const { hasActivePayment } = await billing.check({
    plans: [GROWTH_PLAN],
    isTest: true,
  });

  return {
    shop: session.shop,
    shopName: data?.shop?.name as string,
    planName: data?.shop?.plan?.publicDisplayName as string,
    productCount: data?.productsCount?.count as number,
    hasActivePayment,
  };
};

export default function Index() {
  const { shopName, planName, productCount, hasActivePayment } =
    useLoaderData<typeof loader>();

  return (
    <s-page heading="Upwise Cart Upsell">
      <s-section heading="Setup check">
        <s-paragraph>
          Connected to <s-text type="strong">{shopName}</s-text> ({planName}).
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>Shopify login and session storage: working</s-list-item>
          <s-list-item>Admin API: {productCount} products found</s-list-item>
          <s-list-item>
            Billing: {hasActivePayment ? "Growth plan active (test)" : "Free plan"}
          </s-list-item>
        </s-unordered-list>
      </s-section>
      <s-section slot="aside" heading="Next">
        <s-paragraph>
          Cart offers arrive in Phase 1. This page confirms the platform works.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
