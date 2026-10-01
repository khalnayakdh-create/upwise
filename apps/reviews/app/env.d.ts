// Secrets aren't in wrangler.jsonc, so `wrangler types` can't see them.
interface Env {
  SHOPIFY_API_SECRET: string;
}
declare namespace Cloudflare {
  interface Env {
    SHOPIFY_API_SECRET: string;
  }
}
