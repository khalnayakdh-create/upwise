import type { Route } from "./+types/app.offers.$id";
import type { HeadersFunction } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation, useSearchParams } from "react-router";
import { useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { FormSaveBar, useSaveBar } from "../lib/save-bar";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getDb } from "@upwise/platform";
import { getShopify } from "../shopify.server";
import { fetchOfferProducts, resolvePlan, syncAll } from "../lib/admin.server";
import {
  countActiveOffers,
  deleteOffer,
  getOffer,
  saveOffer,
  validateOfferInput,
  type OfferProduct,
} from "../lib/offers.server";
import { PLAN_LIMITS } from "../lib/plans";

interface PickedProduct {
  id: string;
  title: string;
  image: string | null;
}

export const loader = async ({ request, context, params }: Route.LoaderArgs) => {
  const { env } = context.cloudflare;
  const { admin, session, billing } = await getShopify(env).authenticate.admin(request);
  const isNew = params.id === "new";
  const { plan } = await resolvePlan(billing, env, session.shop);
  const offer = isNew ? null : await getOffer(getDb(env.DB), session.shop, params.id);
  if (!isNew && !offer) throw redirect("/app/offers");

  // Titles/images for trigger products (not stored), fetched fresh.
  const triggers = offer?.triggerProductIds.length
    ? (await fetchOfferProducts(admin, offer.triggerProductIds)).products
    : [];

  return {
    isNew,
    canDiscount: PLAN_LIMITS[plan].discounts,
    offer: {
      name: offer?.name ?? "",
      headline: offer?.headline ?? "You may also like",
      status: offer?.status ?? "active",
      triggerType: offer?.triggerType ?? "all",
      priority: offer?.priority ?? 0,
      discountPercent: offer?.discountPercent ?? 0,
      triggerProducts: triggers.map(toPicked),
      offerProducts: (offer?.offerProducts ?? []).map(toPicked),
    },
  };
};

function toPicked(p: OfferProduct): PickedProduct {
  return { id: p.productId, title: p.title, image: p.image };
}

export const action = async ({ request, context, params }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const { admin, session, billing } = await getShopify(env).authenticate.admin(request);
  const db = getDb(env.DB);
  const form = Object.fromEntries(await request.formData());
  const id = params.id === "new" ? null : params.id;
  const { plan } = await resolvePlan(billing, env, session.shop);

  if (form.intent === "delete" && id) {
    await deleteOffer(db, session.shop, id);
    await syncAll(admin, env, session.shop, plan);
    return redirect("/app/offers?deleted=1");
  }

  const { input, errors } = validateOfferInput(form);
  if (!PLAN_LIMITS[plan].discounts) input.discountPercent = 0;
  if (input.status === "active") {
    const others = await countActiveOffers(db, session.shop, id ?? undefined);
    if (others + 1 > PLAN_LIMITS[plan].maxActiveOffers) {
      errors.status =
        "The Free plan includes 1 active offer. Pause your other offer or upgrade to Growth for unlimited offers.";
    }
  }
  if (Object.keys(errors).length) return { errors };

  const { products, missing } = await fetchOfferProducts(admin, input.offerProductIds);
  if (missing.length || products.length === 0) {
    return { errors: { offerProductIds: "Some products couldn't be found or have no variants. Pick again." } };
  }
  const savedId = await saveOffer(db, session.shop, id, input, products);
  const warning = await syncAll(admin, env, session.shop, plan);
  if (warning) return redirect(`/app/offers/${savedId}?warning=${encodeURIComponent(warning)}`);
  return redirect("/app/offers?saved=1");
};

export default function OfferEditor() {
  const { isNew, offer, canDiscount } = useLoaderData<typeof loader>();
  const [search] = useSearchParams();
  const warning = search.get("warning");
  const actionData = useActionData<typeof action>();
  const errors: Record<string, string> = actionData?.errors ?? {};
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";
  const shopify = useAppBridge();
  const formRef = useRef<HTMLFormElement>(null);
  const checkDirty = useSaveBar(formRef, "offer-save-bar", offer);

  const [triggerType, setTriggerType] = useState<string>(offer.triggerType);
  const [triggerProducts, setTriggerProducts] = useState<PickedProduct[]>(offer.triggerProducts);
  const [offerProducts, setOfferProducts] = useState<PickedProduct[]>(offer.offerProducts);

  const markDirty = checkDirty;

  async function pick(current: PickedProduct[], max: number, set: (p: PickedProduct[]) => void) {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: max,
      action: "select",
      filter: { variants: false, draft: false, archived: false },
      selectionIds: current.map((p) => ({ id: p.id })),
    });
    if (!selected) return;
    set(
      selected.slice(0, max).map((p) => {
        const product = p as unknown as { id: string; title: string; images?: Array<{ originalSrc?: string }> };
        return { id: product.id, title: product.title, image: product.images?.[0]?.originalSrc ?? null };
      }),
    );
    markDirty();
  }

  return (
    <s-page heading={isNew ? "Create offer" : offer.name || "Edit offer"}>
      <s-link slot="breadcrumb-actions" href="/app/offers">
        Offers
      </s-link>
      {warning ? (
        <s-banner tone="warning" heading="Offer saved, but the discount wasn't updated">
          {warning}
        </s-banner>
      ) : null}
      <FormSaveBar id="offer-save-bar" formRef={formRef} saving={saving} />
      <Form method="post" ref={formRef}>
        <input type="hidden" name="triggerProductIds" value={JSON.stringify(triggerProducts.map((p) => p.id))} />
        <input type="hidden" name="offerProductIds" value={JSON.stringify(offerProducts.map((p) => p.id))} />

        <s-section heading="Offer">
          <s-stack gap="base">
            <s-text-field
              label="Name"
              name="name"
              value={offer.name}
              placeholder="e.g. Accessories for any cart"
              details="Only you see this."
              error={errors.name}
              maxLength={80}
            />
            <s-text-field
              label="Headline"
              name="headline"
              value={offer.headline}
              details="Shown above the recommendations in the cart."
              error={errors.headline}
              maxLength={120}
            />
            <s-switch
              label="Active"
              name="status"
              value="active"
              checked={offer.status === "active"}
              details="Paused offers stay saved but don't appear on your store."
              error={errors.status}
            />
          </s-stack>
        </s-section>

        <s-section heading="Products to recommend">
          <s-stack gap="base">
            <s-paragraph>Up to 3. Products already in the cart are skipped automatically.</s-paragraph>
            <ProductList products={offerProducts} onRemove={(id) => { setOfferProducts(offerProducts.filter((p) => p.id !== id)); markDirty(); }} />
            {errors.offerProductIds ? <s-text tone="critical">{errors.offerProductIds}</s-text> : null}
            <s-button onClick={() => pick(offerProducts, 3, setOfferProducts)}>
              {offerProducts.length ? "Change products" : "Select products"}
            </s-button>
          </s-stack>
        </s-section>

        <s-section heading="Discount">
          <s-stack gap="base">
            <s-number-field
              label="Discount on recommended products"
              name="discountPercent"
              value={String(offer.discountPercent)}
              min={0}
              max={90}
              suffix="%"
              disabled={!canDiscount}
              details={
                canDiscount
                  ? "Applied automatically at checkout when the shopper adds a product from this offer. 0 = no discount."
                  : "Available on Growth and Pro plans."
              }
            />
            {!canDiscount ? <s-link href="/app/plans">Compare plans</s-link> : null}
          </s-stack>
        </s-section>

        <s-section heading="When to show it">
          <s-stack gap="base">
            <s-select
              label="Show this offer"
              name="triggerType"
              value={triggerType}
              onInput={(e) => { setTriggerType(String(e.currentTarget.value)); markDirty(); }}
            >
              <s-option value="all">For any cart</s-option>
              <s-option value="products">When specific products are in the cart</s-option>
            </s-select>
            {triggerType === "products" ? (
              <>
                <ProductList products={triggerProducts} onRemove={(id) => { setTriggerProducts(triggerProducts.filter((p) => p.id !== id)); markDirty(); }} />
                {errors.triggerProductIds ? <s-text tone="critical">{errors.triggerProductIds}</s-text> : null}
                <s-button onClick={() => pick(triggerProducts, 50, setTriggerProducts)}>
                  {triggerProducts.length ? "Change trigger products" : "Select trigger products"}
                </s-button>
              </>
            ) : null}
            <s-number-field
              label="Priority"
              name="priority"
              value={String(offer.priority)}
              min={0}
              max={1000}
              details="When several offers match a cart, the highest priority is shown."
            />
          </s-stack>
        </s-section>

        <s-stack direction="inline" gap="base" justifyContent="end" padding="base none">
          <s-button type="submit" variant="primary" loading={saving}>
            Save
          </s-button>
        </s-stack>
      </Form>

      {!isNew ? (
        <Form method="post">
          <input type="hidden" name="intent" value="delete" />
          <s-section heading="Delete offer">
            <s-stack gap="base">
              <s-paragraph>Removes the offer and its stats from Upwise. This can't be undone.</s-paragraph>
              <s-button type="submit" tone="critical">Delete offer</s-button>
            </s-stack>
          </s-section>
        </Form>
      ) : null}
    </s-page>
  );
}

function ProductList({ products, onRemove }: { products: PickedProduct[]; onRemove: (id: string) => void }) {
  if (!products.length) return <s-text color="subdued">No products selected.</s-text>;
  return (
    <s-stack gap="small">
      {products.map((p) => (
        <s-stack key={p.id} direction="inline" gap="small" alignItems="center" justifyContent="space-between">
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-thumbnail src={p.image ?? undefined} alt="" size="small" />
            <s-text>{p.title}</s-text>
          </s-stack>
          <s-button variant="tertiary" icon="x" accessibilityLabel={`Remove ${p.title}`} onClick={() => onRemove(p.id)} />
        </s-stack>
      ))}
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
