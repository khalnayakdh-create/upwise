import type { Route } from "./+types/app.thank-you";
import type { HeadersFunction } from "react-router";
import { Form, useLoaderData, useNavigation, useSearchParams } from "react-router";
import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { FormSaveBar, useSaveBar } from "../lib/save-bar";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getDb } from "@upwise/platform";
import { redirect } from "react-router";
import { getShopify } from "../shopify.server";
import {
  fetchOfferProducts,
  getThankYouConfig,
  resolvePlan,
  setSetting,
  storeHandle,
  syncThankYou,
  THANK_YOU_SETTING,
  type ThankYouConfig,
} from "../lib/admin.server";
import { PLAN_LIMITS } from "../lib/plans";

interface Picked {
  id: string;
  title: string;
  image: string | null;
}

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  const { env } = context.cloudflare;
  const { billing, session } = await getShopify(env).authenticate.admin(request);
  const { plan } = await resolvePlan(billing, env, session.shop);
  const config = await getThankYouConfig(getDb(env.DB), session.shop);
  return {
    allowed: PLAN_LIMITS[plan].thankYouOffers,
    config,
    checkoutEditorUrl: `https://admin.shopify.com/store/${storeHandle(session.shop)}/settings/checkout`,
  };
};

export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const { admin, billing, session } = await getShopify(env).authenticate.admin(request);
  const { plan } = await resolvePlan(billing, env, session.shop);
  if (!PLAN_LIMITS[plan].thankYouOffers) return redirect("/app/plans");
  const form = Object.fromEntries(await request.formData());
  let ids: string[] = [];
  try {
    ids = (JSON.parse(String(form.productIds ?? "[]")) as unknown[])
      .filter((v): v is string => typeof v === "string" && /^gid:\/\/shopify\/Product\/\d+$/.test(v))
      .slice(0, 3);
  } catch {
    ids = [];
  }
  const { products } = await fetchOfferProducts(admin, ids);
  const config: ThankYouConfig = {
    enabled: form.enabled === "on",
    heading: String(form.heading ?? "").trim().slice(0, 80),
    body: String(form.body ?? "").trim().slice(0, 200),
    discountCode: String(form.discountCode ?? "").trim().slice(0, 40),
    products: products.map((p) => ({ handle: p.handle, productId: p.productId, title: p.title, image: p.image })),
  };
  await setSetting(getDb(env.DB), session.shop, THANK_YOU_SETTING, JSON.stringify(config));
  await syncThankYou(admin, env, session.shop, plan);
  return redirect("/app/thank-you?saved=1");
};

export default function ThankYouSettings() {
  const { allowed, config, checkoutEditorUrl } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const [params] = useSearchParams();
  const saving = useNavigation().state === "submitting";
  const formRef = useRef<HTMLFormElement>(null);
  const checkDirty = useSaveBar(formRef, "thank-you-save-bar", config);
  const [products, setProducts] = useState<Picked[]>(
    config.products.map((p) => ({ id: p.productId, title: p.title, image: p.image })),
  );

  useEffect(() => {
    if (params.get("saved")) {
      shopify.toast.show("Thank-you page offer saved");
    }
  }, [params, shopify]);

  async function pick() {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: 3,
      filter: { variants: false, draft: false, archived: false },
      selectionIds: products.map((p) => ({ id: p.id })),
    });
    if (!selected) return;
    setProducts(
      selected.slice(0, 3).map((p) => {
        const product = p as unknown as { id: string; title: string; images?: Array<{ originalSrc?: string }> };
        return { id: product.id, title: product.title, image: product.images?.[0]?.originalSrc ?? null };
      }),
    );
    checkDirty();
  }

  if (!allowed) {
    return (
      <s-page heading="Thank-you page offers">
        <s-section>
          <s-empty-state heading="Recommend products after checkout">
            <s-paragraph>
              Show up to 3 products and an optional discount code on your order confirmation page. Available on
              the Pro plan.
            </s-paragraph>
            <s-button slot="primary-action" variant="primary" href="/app/plans">
              View plans
            </s-button>
          </s-empty-state>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Thank-you page offers">
      <FormSaveBar id="thank-you-save-bar" formRef={formRef} saving={saving} />
      <Form method="post" ref={formRef}>
        <input type="hidden" name="productIds" value={JSON.stringify(products.map((p) => p.id))} />
        <s-section heading="Offer">
          <s-stack gap="base">
            <s-switch label="Show offer on the thank-you page" name="enabled" checked={config.enabled} />
            <s-text-field label="Heading" name="heading" value={config.heading} placeholder="You might also like" maxLength={80} />
            <s-text-area label="Message" name="body" value={config.body} maxLength={200} rows={2} />
            <s-text-field
              label="Discount code (optional)"
              name="discountCode"
              value={config.discountCode}
              details="Create the code in Shopify Discounts first; Upwise shows it to the customer."
              maxLength={40}
            />
          </s-stack>
        </s-section>
        <s-section heading="Products">
          <s-stack gap="base">
            {products.length ? (
              products.map((p) => (
                <s-stack key={p.id} direction="inline" gap="small" alignItems="center">
                  <s-thumbnail src={p.image ?? undefined} alt="" size="small" />
                  <s-text>{p.title}</s-text>
                </s-stack>
              ))
            ) : (
              <s-text color="subdued">No products selected.</s-text>
            )}
            <s-button onClick={pick}>{products.length ? "Change products" : "Select products"}</s-button>
          </s-stack>
        </s-section>
        <s-stack direction="inline" justifyContent="end" padding="base none">
          <s-button type="submit" variant="primary" loading={saving}>
            Save
          </s-button>
        </s-stack>
      </Form>
      <s-section slot="aside" heading="Add it to your thank-you page">
        <s-paragraph>
          In the checkout editor, switch to the Thank you page and add the “Upwise thank you offers” block.
        </s-paragraph>
        <s-button href={checkoutEditorUrl} target="_blank">
          Open checkout settings
        </s-button>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
