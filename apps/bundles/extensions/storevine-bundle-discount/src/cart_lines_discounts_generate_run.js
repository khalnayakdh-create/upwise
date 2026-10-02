/**
 * Storevine bundle discount.
 * Config ($app:function-configuration):
 *   {
 *     bundles: [{ id, percent, message, productIds: [gid] }],                       // bought together
 *     volume:  [{ id, message, tiers: [{ min, percent }], productIds: [gid] }]      // quantity breaks / mix and match
 *   }
 *
 * Bought together: when every product is in the cart, discount `sets` units of each,
 * where sets = the smallest quantity among the bundle's products.
 * Volume: count the units of the bundle's products still undiscounted; if that count
 * reaches a tier, discount all of those units by the best tier reached.
 *
 * Every unit is discounted at most once: bought-together bundles go first, then
 * volume bundles, each consuming the units it discounts (first match wins).
 */

const validPercent = (p) => Number(p) > 0 && Number(p) <= 100;

/** @param {any} input */
export function cartLinesDiscountsGenerateRun(input) {
  const none = { operations: [] };
  if (!input.discount.discountClasses.includes("PRODUCT")) return none;
  const config = input.discount.metafield?.jsonValue ?? {};
  const fixed = (Array.isArray(config.bundles) ? config.bundles : []).filter(
    (b) => b && Array.isArray(b.productIds) && b.productIds.length >= 2 && validPercent(b.percent),
  );
  const volume = (Array.isArray(config.volume) ? config.volume : [])
    .filter((b) => b && Array.isArray(b.productIds) && b.productIds.length >= 1 && Array.isArray(b.tiers))
    .map((b) => ({
      ...b,
      tiers: b.tiers
        .filter((t) => t && Number(t.min) >= 2 && validPercent(t.percent))
        .map((t) => ({ min: Math.floor(Number(t.min)), percent: Number(t.percent) }))
        .sort((a, c) => a.min - c.min),
    }))
    .filter((b) => b.tiers.length > 0);
  if (!fixed.length && !volume.length) return none;

  // Remaining (undiscounted) quantity per line, and lines grouped by product.
  const remaining = new Map();
  const linesByProduct = new Map();
  for (const line of input.cart.lines) {
    if (line.merchandise?.__typename !== "ProductVariant") continue;
    const pid = line.merchandise.product.id;
    remaining.set(line.id, line.quantity);
    if (!linesByProduct.has(pid)) linesByProduct.set(pid, []);
    linesByProduct.get(pid).push(line);
  }
  const qtyFor = (pid) => (linesByProduct.get(pid) ?? []).reduce((n, l) => n + (remaining.get(l.id) ?? 0), 0);

  /** Take up to `need` units of a product, consuming them; returns cart-line targets. */
  function take(pid, need) {
    const targets = [];
    for (const line of linesByProduct.get(pid) ?? []) {
      if (need <= 0) break;
      const n = Math.min(need, remaining.get(line.id) ?? 0);
      if (n <= 0) continue;
      targets.push({ cartLine: { id: line.id, quantity: n } });
      remaining.set(line.id, (remaining.get(line.id) ?? 0) - n);
      need -= n;
    }
    return targets;
  }

  const candidates = [];
  for (const b of fixed) {
    const sets = Math.min(...b.productIds.map(qtyFor));
    if (!(sets >= 1)) continue;
    const targets = b.productIds.flatMap((pid) => take(pid, sets));
    candidates.push({
      message: typeof b.message === "string" && b.message ? b.message : `Bundle ${b.percent}% off`,
      targets,
      value: { percentage: { value: Number(b.percent) } },
    });
  }

  for (const b of volume) {
    const pids = [...new Set(b.productIds)];
    const count = pids.reduce((n, pid) => n + qtyFor(pid), 0);
    const tier = b.tiers.filter((t) => count >= t.min).pop();
    if (!tier) continue;
    const targets = pids.flatMap((pid) => take(pid, qtyFor(pid)));
    if (!targets.length) continue;
    const label = typeof b.message === "string" && b.message ? `${b.message}: ` : "";
    candidates.push({
      message: `${label}buy ${tier.min}+, save ${tier.percent}%`,
      targets,
      value: { percentage: { value: tier.percent } },
    });
  }

  if (!candidates.length) return none;
  return { operations: [{ productDiscountsAdd: { candidates, selectionStrategy: "ALL" } }] };
}
