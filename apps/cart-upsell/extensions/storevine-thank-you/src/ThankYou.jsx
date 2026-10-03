import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

/**
 * Thank-you page offers (Storevine Cart Upsell, Growth plan).
 * Reads $app:thank_you_config (shop metafield written by the app):
 *   { enabled, heading, body, discountCode, products: [{ handle }] }
 * Shows up to 3 products with live data from the Storefront API.
 * No timers, no auto-opening modals, nothing added to the order.
 */
export default async () => {
  render(<Extension />, document.body);
};

function readConfig() {
  const entry = shopify.appMetafields.value.find(
    (m) => m.target.type === "shop" && m.metafield.namespace === "$app" && m.metafield.key === "thank_you_config",
  );
  if (!entry) return null;
  try {
    return JSON.parse(String(entry.metafield.value));
  } catch {
    return null;
  }
}

const PRODUCT_QUERY = `query StorevineProduct($handle: String!) {
  product(handle: $handle) {
    title
    handle
    availableForSale
    featuredImage { url altText }
    priceRange { minVariantPrice { amount currencyCode } }
  }
}`;

function EditorNote({ reason }) {
  // Only merchants see this, in the checkout editor.
  if (!shopify.extension.editor) return null;
  const text = {
    "no-config": "Storevine: set up thank-you offers in the Storevine Cart Upsell app (Growth plan).",
    disabled: "Storevine: thank-you offers are turned off in the app, or your plan doesn't include them.",
    "no-products": "Storevine: no available products to show. Pick products in the app.",
    loading: "Storevine: loading products…",
  }[reason];
  return <s-banner tone="info">{text}</s-banner>;
}

function Extension() {
  const config = readConfig();
  const [products, setProducts] = useState(null);
  const handles = (config?.products ?? []).map((p) => p.handle).filter(Boolean).slice(0, 3);

  useEffect(() => {
    if (!config?.enabled || !handles.length) return;
    let cancelled = false;
    Promise.all(
      handles.map((handle) =>
        shopify
          .query(PRODUCT_QUERY, { variables: { handle } })
          .then((r) => r?.data?.product ?? null)
          .catch(() => null),
      ),
    ).then((list) => {
      if (!cancelled) setProducts(list.filter((p) => p && p.availableForSale));
    }).catch(() => {
      if (!cancelled) setProducts([]);
    });
    return () => {
      cancelled = true;
    };
  }, [handles.join(",")]);

  if (!config) return <EditorNote reason="no-config" />;
  if (!config.enabled) return <EditorNote reason="disabled" />;
  if (!handles.length) return <EditorNote reason="no-products" />;
  if (products === null) return <EditorNote reason="loading" />;
  if (!products.length) return <EditorNote reason="no-products" />;

  const base = String(shopify.shop?.storefrontUrl ?? "").replace(/\/$/, "");
  const money = (m) => shopify.i18n.formatCurrency(Number(m.amount), { currencyCode: m.currencyCode });

  return (
    <s-section heading={config.heading || shopify.i18n.translate("heading")}>
      <s-stack gap="base">
        {config.body ? <s-text>{config.body}</s-text> : null}
        {config.discountCode ? (
          <s-text type="strong">{shopify.i18n.translate("codeLabel", { code: config.discountCode })}</s-text>
        ) : null}
        {products.map((p) => (
          <s-stack key={p.handle} direction="inline" gap="base" alignItems="center">
            {p.featuredImage ? (
              <s-product-thumbnail src={p.featuredImage.url} alt={p.featuredImage.altText || p.title} size="base" />
            ) : null}
            <s-stack gap="small-200">
              <s-text type="strong">{p.title}</s-text>
              <s-text>{money(p.priceRange.minVariantPrice)}</s-text>
              <s-link href={`${base}/products/${p.handle}`} target="_blank">
                {shopify.i18n.translate("view")}
              </s-link>
            </s-stack>
          </s-stack>
        ))}
      </s-stack>
    </s-section>
  );
}
