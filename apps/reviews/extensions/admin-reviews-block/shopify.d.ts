import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/ProductReviewsBlock.jsx' {
  const shopify: import('@shopify/ui-extensions/admin.product-details.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}
