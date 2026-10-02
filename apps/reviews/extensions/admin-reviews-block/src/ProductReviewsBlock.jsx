import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

/**
 * Storevine Reviews block on the admin product page.
 * Data comes from the app (GET api/admin-block); relative fetches go to the
 * app URL with the admin session token attached automatically.
 */
export default async () => {
  render(<Block />, document.body);
};

const stars = (n) => "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n);

function Block() {
  const { i18n, data } = shopify;
  const productId = data.selected?.[0]?.id;
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    fetch(`api/admin-block?product=${encodeURIComponent(productId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => !cancelled && setState({ data: d }))
      .catch(() => !cancelled && setState({ error: true }));
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const numeric = productId ? productId.split("/").pop() : "";
  const d = state.data;
  return (
    <s-admin-block heading={i18n.translate("heading")}>
      {state.loading && !d && !state.error ? <s-text>{i18n.translate("loading")}</s-text> : null}
      {state.error ? <s-text tone="critical">{i18n.translate("error")}</s-text> : null}
      {d ? (
        <s-stack gap="base">
          {d.count === 0 && d.pending === 0 ? (
            <s-text>{i18n.translate("none")}</s-text>
          ) : (
            <s-stack gap="small-200">
              {d.count > 0 ? (
                <s-text type="strong">
                  {d.count === 1
                    ? i18n.translate("summaryOne", { average: d.average.toFixed(1) })
                    : i18n.translate("summary", { average: d.average.toFixed(1), total: d.count })}
                </s-text>
              ) : null}
              {d.pending > 0 ? (
                <s-badge tone="attention">
                  {d.pending === 1 ? i18n.translate("pendingOne") : i18n.translate("pending", { total: d.pending })}
                </s-badge>
              ) : null}
            </s-stack>
          )}
          {d.latest.map((r) => (
            <s-box key={r.id} padding="small-200" border="base" borderRadius="base">
              <s-stack gap="small-300">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-text accessibilityLabel={`${r.rating} / 5`}>{stars(r.rating)}</s-text>
                  <s-text type="strong">{r.title || r.author}</s-text>
                  {r.verified ? <s-badge tone="success">{i18n.translate("verified")}</s-badge> : null}
                  {r.status === "pending" ? <s-badge tone="attention">{i18n.translate("statusPending")}</s-badge> : null}
                  {r.status === "hidden" ? <s-badge>{i18n.translate("statusHidden")}</s-badge> : null}
                </s-stack>
                <s-text color="subdued">{r.body}</s-text>
              </s-stack>
            </s-box>
          ))}
          {d.count + d.pending > 0 ? <s-link href={`shopify:admin/apps/upwise-reviews/app/reviews?product=${numeric}`}>{i18n.translate("viewAll")}</s-link> : null}
        </s-stack>
      ) : null}
    </s-admin-block>
  );
}
