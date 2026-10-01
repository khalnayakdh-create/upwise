import type { Route } from "./+types/app.bundles.$id";
import type { HeadersFunction } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getDb } from "@upwise/platform";
import { FormSaveBar, useSaveBar } from "@upwise/shopify-app/react";
import { getShopify } from "../shopify.server";
import { fetchProducts, resolvePlan, syncAll } from "../lib/admin.server";
import { countActive, deleteBundle, getBundle, saveBundle, validateBundleInput } from "../lib/bundles.server";
import { PLAN_LIMITS } from "../lib/plans";

interface Picked { id: string; title: string; image: string | null }

export const loader = async ({ request, context, params }: Route.LoaderArgs) => {
  const { env } = context.cloudflare;
  const { session } = await getShopify(env).authenticate.admin(request);
  const isNew = params.id === "new";
  const bundle = isNew ? null : await getBundle(getDb(env.DB), session.shop, params.id);
  if (!isNew && !bundle) throw redirect("/app/bundles");
  return {
    isNew,
    bundle: {
      name: bundle?.name ?? "",
      title: bundle?.title ?? "Frequently bought together",
      status: bundle?.status ?? "active",
      discountPercent: bundle?.discountPercent ?? 10,
      products: (bundle?.products ?? []).map((p) => ({ id: p.productId, title: p.title, image: p.image })),
    },
  };
};

export const action = async ({ request, context, params }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const { admin, session, billing } = await getShopify(env).authenticate.admin(request);
  const db = getDb(env.DB);
  const id = params.id === "new" ? null : params.id;
  const form = Object.fromEntries(await request.formData());
  const { plan } = await resolvePlan(billing as never, env, session.shop);
  if (form.intent === "delete" && id) {
    await deleteBundle(db, session.shop, id);
    await syncAll(admin.graphql as never, env, session.shop, plan);
    return redirect("/app/bundles?deleted=1");
  }
  const { input, errors } = validateBundleInput(form);
  if (input.status === "active" && (await countActive(db, session.shop, id ?? undefined)) + 1 > PLAN_LIMITS[plan].maxActiveBundles) {
    errors.status = "The Free plan includes 1 active bundle. Pause another bundle or upgrade to Growth.";
  }
  if (Object.keys(errors).length) return { errors };
  const { products, missing } = await fetchProducts(admin.graphql as never, input.productIds);
  if (missing.length) return { errors: { productIds: "Some products couldn't be found. Pick again." } };
  await saveBundle(db, session.shop, id, input, products);
  const warning = await syncAll(admin.graphql as never, env, session.shop, plan);
  if (warning) return { errors: { discountPercent: warning } as Record<string, string> };
  return redirect("/app/bundles?saved=1");
};

export default function BundleEditor() {
  const { isNew, bundle } = useLoaderData<typeof loader>();
  const errors: Record<string, string> = useActionData<typeof action>()?.errors ?? {};
  const saving = useNavigation().state === "submitting";
  const shopify = useAppBridge();
  const formRef = useRef<HTMLFormElement>(null);
  const [products, setProducts] = useState<Picked[]>(bundle.products);
  const checkDirty = useSaveBar(formRef, "bundle-save-bar", bundle);

  async function pick() {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: 5,
      filter: { variants: false, draft: false, archived: false },
      selectionIds: products.map((p) => ({ id: p.id })),
    });
    if (!selected) return;
    setProducts(selected.slice(0, 5).map((p) => {
      const x = p as unknown as { id: string; title: string; images?: Array<{ originalSrc?: string }> };
      return { id: x.id, title: x.title, image: x.images?.[0]?.originalSrc ?? null };
    }));
    checkDirty();
  }

  return (
    <s-page heading={isNew ? "Create bundle" : bundle.name}>
      <s-link slot="breadcrumb-actions" href="/app/bundles">Bundles</s-link>
      <FormSaveBar id="bundle-save-bar" formRef={formRef} saving={saving} />
      <Form method="post" ref={formRef}>
        <input type="hidden" name="productIds" value={JSON.stringify(products.map((p) => p.id))} />
        <s-section heading="Bundle">
          <s-stack gap="base">
            <s-text-field label="Name" name="name" value={bundle.name} details="Only you see this." error={errors.name} maxLength={80} />
            <s-text-field label="Heading on your store" name="title" value={bundle.title} maxLength={80} />
            <s-switch label="Active" name="status" value="active" checked={bundle.status === "active"} error={errors.status} />
          </s-stack>
        </s-section>
        <s-section heading="Products (2–5)">
          <s-stack gap="base">
            {products.length ? products.map((p) => (
              <s-stack key={p.id} direction="inline" gap="small" alignItems="center">
                <s-thumbnail src={p.image ?? undefined} alt="" size="small" />
                <s-text>{p.title}</s-text>
              </s-stack>
            )) : <s-text color="subdued">No products selected.</s-text>}
            {errors.productIds ? <s-text tone="critical">{errors.productIds}</s-text> : null}
            <s-button onClick={pick}>{products.length ? "Change products" : "Select products"}</s-button>
            <s-text color="subdued">The block appears on each of these products' pages.</s-text>
          </s-stack>
        </s-section>
        <s-section heading="Discount">
          <s-number-field
            label="Discount when all products are in the cart"
            name="discountPercent"
            value={String(bundle.discountPercent)}
            min={0}
            max={90}
            suffix="%"
            error={errors.discountPercent}
            details="Applied automatically at checkout to one set of each bundle product. 0 = no discount."
          />
        </s-section>
        <s-stack direction="inline" justifyContent="end" padding="base none">
          <s-button type="submit" variant="primary" loading={saving}>Save</s-button>
        </s-stack>
      </Form>
      {!isNew ? (
        <Form method="post">
          <input type="hidden" name="intent" value="delete" />
          <s-section heading="Delete bundle">
            <s-stack gap="base">
              <s-paragraph>Removes the bundle and its stats. This can't be undone.</s-paragraph>
              <s-button type="submit" tone="critical">Delete bundle</s-button>
            </s-stack>
          </s-section>
        </Form>
      ) : null}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
