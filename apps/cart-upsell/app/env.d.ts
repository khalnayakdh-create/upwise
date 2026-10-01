// Secrets aren't in wrangler.jsonc, so `wrangler types` can't see them.
// Set SHOPIFY_API_SECRET in Cloudflare: Worker > Settings > Variables and Secrets.
interface Env {
  /** Shopify app client secret. */
  SHOPIFY_API_SECRET: string;
}
declare namespace Cloudflare {
  interface Env {
    SHOPIFY_API_SECRET: string;
  }
}
