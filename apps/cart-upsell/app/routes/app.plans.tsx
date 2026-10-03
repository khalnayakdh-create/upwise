import type { Route } from "./+types/app.plans";
import type { HeadersFunction } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getShopify } from "../shopify.server";
import { resolvePlan, storeHandle, syncAll } from "../lib/admin.server";
import { GROWTH_PLAN, OFFERED_PLANS, PLAN_COPY } from "../lib/plans";

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  const { env } = context.cloudflare;
  const { admin, billing, session } = await getShopify(env).authenticate.admin(request);
  const { plan, changed, subscriptionId } = await resolvePlan(billing, env, session.shop);
  if (changed) await syncAll(admin, env, session.shop, plan);
  return { plan, subscriptionId };
};

export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const { admin, billing, session } = await getShopify(env).authenticate.admin(request);
  const form = await request.formData();
  const isTest = env.BILLING_TEST_MODE !== "false";

  if (form.get("intent") === "cancel") {
    const id = String(form.get("subscriptionId") ?? "");
    if (id) await billing.cancel({ subscriptionId: id, isTest, prorate: true });
    const { plan } = await resolvePlan(billing, env, session.shop);
    await syncAll(admin, env, session.shop, plan);
    return { billingError: null };
  }

  const target = GROWTH_PLAN;
  try {
    return await billing.request({
      plan: target,
      isTest,
      returnUrl: `https://admin.shopify.com/store/${storeHandle(session.shop)}/apps/${env.SHOPIFY_API_KEY}/app/plans`,
    });
  } catch (error) {
    if (error instanceof Response) throw error; // success = redirect to Shopify approval
    const details = (error as { errorData?: unknown }).errorData;
    console.error("Billing request failed", error, JSON.stringify(details));
    const message = Array.isArray(details)
      ? details.map((d) => (d && typeof d === "object" && "message" in d ? String(d.message) : "")).join(" ")
      : String(error);
    return { billingError: message || "Billing request failed." };
  }
};

export default function Plans() {
  const { plan, subscriptionId } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";

  return (
    <s-page heading="Plans">
      {actionData?.billingError ? (
        <s-banner tone="critical" heading="Couldn't start the subscription">
          {actionData.billingError}
        </s-banner>
      ) : null}
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
        {OFFERED_PLANS.map((key) => {
          const copy = PLAN_COPY[key];
          // Legacy Pro subscribers have everything Growth has.
          const current = key === plan || (key === "growth" && plan === "pro");
          return (
            <s-section key={key} heading={copy.name}>
              <s-stack gap="base">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-heading>{copy.price}</s-heading>
                  {current ? <s-badge tone="success">Current plan</s-badge> : null}
                </s-stack>
                <s-unordered-list>
                  {copy.features.map((f) => (
                    <s-list-item key={f}>{f}</s-list-item>
                  ))}
                </s-unordered-list>
                {copy.billingName && !current ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="subscribe" />
                    <input type="hidden" name="plan" value={copy.billingName} />
                    <s-button type="submit" variant={key === "growth" ? "primary" : "secondary"} loading={busy}>
                      {plan === "free" ? "Start free trial" : `Switch to ${copy.name}`}
                    </s-button>
                  </Form>
                ) : null}
                {key === "free" && plan !== "free" && subscriptionId ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="cancel" />
                    <input type="hidden" name="subscriptionId" value={subscriptionId} />
                    <s-button type="submit" loading={busy}>
                      Switch to Free
                    </s-button>
                  </Form>
                ) : null}
              </s-stack>
            </s-section>
          );
        })}
      </s-grid>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
