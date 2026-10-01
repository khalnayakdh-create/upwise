import { describe, expect, it } from "vitest";

// Plain JS module (compiled to Wasm by Shopify CLI at deploy); test the logic directly.
const modulePath = "../extensions/upwise-cart-discount/src/cart_lines_discounts_generate_run.js";
const { cartLinesDiscountsGenerateRun: run } = (await import(modulePath)) as {
  cartLinesDiscountsGenerateRun: (input: unknown) => { operations: Array<Record<string, any>> };
};

const product = (n: number) => `gid://shopify/Product/${n}`;
const line = (id: string, productN: number, offer?: string) => ({
  id,
  attribute: offer ? { value: offer } : null,
  merchandise: { __typename: "ProductVariant", product: { id: product(productN) } },
});
const input = (lines: unknown[], offers: Record<string, unknown>, classes = ["PRODUCT"]) => ({
  cart: { lines },
  discount: { discountClasses: classes, metafield: { jsonValue: { offers } } },
});
const OFFER = { o1: { percent: 10, message: "10% off", productIds: [product(2)], triggerProductIds: [] } };

describe("upwise-cart-discount function", () => {
  it("discounts an offer product added from the widget", () => {
    const out = run(input([line("l1", 1), line("l2", 2, "o1")], OFFER));
    expect(out.operations).toHaveLength(1);
    const op = out.operations[0].productDiscountsAdd;
    expect(op.selectionStrategy).toBe("ALL");
    expect(op.candidates).toEqual([
      { message: "10% off", targets: [{ cartLine: { id: "l2" } }], value: { percentage: { value: 10 } } },
    ]);
  });

  it("ignores the attribute on a product that isn't part of the offer", () => {
    expect(run(input([line("l1", 1), line("l2", 7, "o1")], OFFER)).operations).toEqual([]);
  });

  it("requires another item in the cart (offer product alone gets no discount)", () => {
    expect(run(input([line("l2", 2, "o1")], OFFER)).operations).toEqual([]);
  });

  it("requires a trigger product when the offer has triggers", () => {
    const offers = { o1: { ...OFFER.o1, triggerProductIds: [product(5)] } };
    expect(run(input([line("l1", 1), line("l2", 2, "o1")], offers)).operations).toEqual([]);
    expect(run(input([line("l1", 5), line("l2", 2, "o1")], offers)).operations).toHaveLength(1);
  });

  it("does nothing without the PRODUCT class, unknown offers, or bad percentages", () => {
    expect(run(input([line("l1", 1), line("l2", 2, "o1")], OFFER, ["ORDER"])).operations).toEqual([]);
    expect(run(input([line("l1", 1), line("l2", 2, "zz")], OFFER)).operations).toEqual([]);
    const bad = { o1: { ...OFFER.o1, percent: 150 } };
    expect(run(input([line("l1", 1), line("l2", 2, "o1")], bad)).operations).toEqual([]);
  });

  it("handles missing config safely", () => {
    const out = run({ cart: { lines: [line("l1", 1)] }, discount: { discountClasses: ["PRODUCT"], metafield: null } });
    expect(out.operations).toEqual([]);
  });
});
