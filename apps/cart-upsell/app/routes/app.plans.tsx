import type { Route } from "./+types/app.plans";
import type { HeadersFunction } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
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
  try {
    return await billing.request({
      plan: GROWTH_PLAN,
      isTest: true,
      returnUrl: `https://admin.shopify.com/store/${storeHandle}/apps/${context.cloudflare.env.SHOPIFY_API_KEY}/app/plans`,
    });
  } catch (error) {
    // billing.request throws a redirect Response on success; let it through.
    if (error instanceof Response) throw error;
    const details = (error as { errorData?: unknown }).errorData;
    console.error("Billing request failed", error, JSON.stringify(details));
    return { billingError: describeBillingError(details) ?? String(error) };
  }
};

function describeBillingError(details: unknown): string | null {
  if (!Array.isArray(details)) return null;
  const messages = details
    .map((d) => (d && typeof d === "object" && "message" in d ? String(d.message) : null))
    .filter(Boolean);
  return messages.length ? messages.join(" ") : null;
}

export default function Plans() {
  const { hasActivePayment, subscriptionId } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const billingError =
    actionData && "billingError" in actionData ? actionData.billingError : null;

  return (
    <s-page heading="Plans">
      {billingError ? (
        <s-banner tone="critical" heading="Billing request failed">
          {billingError}
        </s-banner>
      ) : null}
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
