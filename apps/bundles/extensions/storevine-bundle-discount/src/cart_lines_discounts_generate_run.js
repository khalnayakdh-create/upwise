/**
 * Storevine bundle discount.
 * Config ($app:function-configuration): { bundles: [{ id, percent, message, productIds: [gid] }] }
 * When every product of a bundle is in the cart, discount `sets` units of each,
 * where sets = the smallest quantity among the bundle's products.
 * A cart line is used by at most one bundle (first match wins) to avoid double discounts.
 */

/** @param {any} input */
export function cartLinesDiscountsGenerateRun(input) {
  const none = { operations: [] };
  if (!input.discount.discountClasses.includes("PRODUCT")) return none;
  const bundles = (input.discount.metafield?.jsonValue?.bundles ?? []).filter(
    (b) => b && Array.isArray(b.productIds) && b.productIds.length >= 2 && Number(b.percent) > 0 && Number(b.percent) <= 100,
  );
  if (!bundles.length) return none;

  // Remaining quantity per line (so one unit isn't discounted by two bundles).
  const remaining = new Map();
  const linesByProduct = new Map();
  for (const line of input.cart.lines) {
    if (line.merchandise?.__typename !== "ProductVariant") continue;
    const pid = line.merchandise.product.id;
    remaining.set(line.id, line.quantity);
    if (!linesByProduct.has(pid)) linesByProduct.set(pid, []);
    linesByProduct.get(pid).push(line);
  }

  const candidates = [];
  for (const b of bundles) {
    const qtyFor = (pid) => (linesByProduct.get(pid) ?? []).reduce((n, l) => n + (remaining.get(l.id) ?? 0), 0);
    const sets = Math.min(...b.productIds.map(qtyFor));
    if (!(sets >= 1)) continue;
    const targets = [];
    for (const pid of b.productIds) {
      let need = sets;
      for (const line of linesByProduct.get(pid) ?? []) {
        if (need <= 0) break;
        const take = Math.min(need, remaining.get(line.id) ?? 0);
        if (take <= 0) continue;
        targets.push({ cartLine: { id: line.id, quantity: take } });
        remaining.set(line.id, (remaining.get(line.id) ?? 0) - take);
        need -= take;
      }
    }
    candidates.push({
      message: typeof b.message === "string" && b.message ? b.message : `Bundle ${b.percent}% off`,
      targets,
      value: { percentage: { value: Number(b.percent) } },
    });
  }
  if (!candidates.length) return none;
  return { operations: [{ productDiscountsAdd: { candidates, selectionStrategy: "ALL" } }] };
}
