import type { Route } from "./+types/app.plans";
import type { HeadersFunction } from "react-router";
import { Form, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getShopify, GROWTH_PLAN } from "../shopify.server";

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  const { billing } = await getShopify(context.cloudflare.env).authenticate.admin(request);
  const { hasActivePayment, appSubscriptions } = await billing.check({
    plans: [GROWTH_PLAN],
    isTest: true,
  });
  return {
    hasActivePayment,
    subscriptionId: appSubscriptions[0]?.id ?? null,
  };
};

export const action = async ({ request, context }: Route.ActionArgs) => {
  const { billing, session } = await getShopify(context.cloudflare.env).authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "cancel") {
    const id = String(form.get("subscriptionId") ?? "");
    if (id) await billing.cancel({ subscriptionId: id, isTest: true, prorate: true });
    return null;
  }

  // Redirects the merchant to Shopify's approval page. isTest: no real charge.
  const storeHandle = session.shop.replace(".myshopify.com", "");
  return billing.request({
    plan: GROWTH_PLAN,
    isTest: true,
    returnUrl: `https://admin.shopify.com/store/${storeHandle}/apps/${context.cloudflare.env.SHOPIFY_API_KEY}/app/plans`,
  });
};

export default function Plans() {
  const { hasActivePayment, subscriptionId } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Plans">
      <s-section heading={hasActivePayment ? "Growth (test)" : "Free"}>
        <s-paragraph>
          Placeholder plan used to verify billing. Real plans and pricing come
          in Phase 1.
        </s-paragraph>
        <Form method="post">
          {hasActivePayment ? (
            <>
              <input type="hidden" name="intent" value="cancel" />
              <input type="hidden" name="subscriptionId" value={subscriptionId ?? ""} />
              <s-button type="submit">Cancel test subscription</s-button>
            </>
          ) : (
            <>
              <input type="hidden" name="intent" value="subscribe" />
              <s-button type="submit" variant="primary">
                Start Growth test subscription
              </s-button>
            </>
          )}
        </Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
