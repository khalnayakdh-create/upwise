/**
 * Upwise cart offer discount.
 *
 * Config (discount metafield $app:function-configuration), written by the app:
 *   { "offers": { "<offerId>": { "percent": 10, "message": "...",
 *       "productIds": ["gid://shopify/Product/1"], "triggerProductIds": [] } } }
 *
 * A line is discounted only if:
 *  - it carries the _upwise_offer attribute naming a configured offer,
 *  - its product is one of that offer's recommended products, and
 *  - the offer's trigger is met by ANOTHER line in the cart (empty = any cart).
 * This stops shoppers from adding the attribute to arbitrary products.
 */

/** @param {any} input */
export function cartLinesDiscountsGenerateRun(input) {
  const none = { operations: [] };
  if (!input.discount.discountClasses.includes("PRODUCT")) return none;

  const config = input.discount.metafield?.jsonValue;
  const offers = (config && typeof config === "object" && config.offers) || {};
  const lines = input.cart.lines;
  if (!lines.length) return none;

  const productOf = (line) =>
    line.merchandise && line.merchandise.__typename === "ProductVariant" ? line.merchandise.product.id : null;

  const candidates = [];
  for (const line of lines) {
    const offerId = line.attribute && line.attribute.value;
    if (!offerId) continue;
    const offer = offers[offerId];
    if (!offer) continue;
    const percent = Number(offer.percent);
    if (!(percent > 0 && percent <= 100)) continue;
    const productId = productOf(line);
    if (!productId || !Array.isArray(offer.productIds) || !offer.productIds.includes(productId)) continue;

    const triggers = Array.isArray(offer.triggerProductIds) ? offer.triggerProductIds : [];
    const others = lines.filter((l) => l.id !== line.id);
    const triggered = triggers.length
      ? others.some((l) => triggers.includes(productOf(l)))
      : others.length > 0;
    if (!triggered) continue;

    candidates.push({
      message: typeof offer.message === "string" && offer.message ? offer.message : `${percent}% off`,
      targets: [{ cartLine: { id: line.id } }],
      value: { percentage: { value: percent } },
    });
  }

  if (!candidates.length) return none;
  return {
    operations: [{ productDiscountsAdd: { candidates, selectionStrategy: "ALL" } }],
  };
}
