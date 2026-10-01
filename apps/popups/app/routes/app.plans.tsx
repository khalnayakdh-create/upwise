import type { Route } from "./+types/app.plans";
import type { HeadersFunction } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { storeHandle } from "@upwise/shopify-app";
import { getShopify } from "../shopify.server";
import { publishConfig, resolvePlan } from "../lib/admin.server";
import { GROWTH_PLAN, PLAN_COPY, type PlanKey } from "../lib/plans";

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  const { env } = context.cloudflare;
  const { billing, session } = await getShopify(env).authenticate.admin(request);
  return resolvePlan(billing as never, env, session.shop);
};

export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const { admin, billing, session } = await getShopify(env).authenticate.admin(request);
  const form = await request.formData();
  const isTest = env.BILLING_TEST_MODE !== "false";
  if (form.get("intent") === "cancel") {
    const id = String(form.get("subscriptionId") ?? "");
    if (id) await billing.cancel({ subscriptionId: id, isTest, prorate: true });
    const { plan } = await resolvePlan(billing as never, env, session.shop);
    await publishConfig(admin.graphql as never, env, session.shop, plan);
    return { billingError: null };
  }
  try {
    return await billing.request({
      plan: GROWTH_PLAN as never,
      isTest,
      returnUrl: `https://admin.shopify.com/store/${storeHandle(session.shop)}/apps/${env.SHOPIFY_API_KEY}/app/plans`,
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    const details = (error as { errorData?: Array<{ message?: string }> }).errorData;
    return { billingError: details?.map((d) => d.message).join(" ") || String(error) };
  }
};

export default function Plans() {
  const { plan, subscriptionId } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <s-page heading="Plans">
      {result?.billingError ? <s-banner tone="critical" heading="Couldn't start the subscription">{result.billingError}</s-banner> : null}
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
        {(Object.keys(PLAN_COPY) as PlanKey[]).map((key) => {
          const copy = PLAN_COPY[key];
          const current = key === plan;
          return (
            <s-section key={key} heading={copy.name}>
              <s-stack gap="base">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-heading>{copy.price}</s-heading>
                  {current ? <s-badge tone="success">Current plan</s-badge> : null}
                </s-stack>
                <s-unordered-list>{copy.features.map((f) => <s-list-item key={f}>{f}</s-list-item>)}</s-unordered-list>
                {copy.billingName && !current ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="subscribe" />
                    <s-button type="submit" variant="primary" loading={busy}>Start free trial</s-button>
                  </Form>
                ) : null}
                {key === "free" && plan !== "free" && subscriptionId ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="cancel" />
                    <input type="hidden" name="subscriptionId" value={subscriptionId} />
                    <s-button type="submit" loading={busy}>Switch to Free</s-button>
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
