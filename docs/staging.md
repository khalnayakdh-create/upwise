# Staging environment

Testing happens on staging, so test data never touches production (Shopify protected customer data requirement 11).

| App | Staging Shopify app (Dev Dashboard) | Client ID | Staging URL | Worker / D1 |
|---|---|---|---|---|
| Cart Upsell | Storevine Cart Upsell Staging | 69beea41fb7d1ee279056440c3569e0c | https://cart-staging.storevine.app | upwise-cart-upsell-staging |
| Reviews | Storevine Reviews Staging | 57d1954ee3dc645b1a29797096a88a22 | https://reviews-staging.storevine.app | upwise-reviews-staging (+ R2 storevine-review-photos-staging) |
| Pop-ups | Storevine Pop-ups Staging | 237ad81936da19c78dc04f5e2765cc45 | https://popups-staging.storevine.app | upwise-popups-staging |
| Bundles | Storevine Bundles Staging | f40e2458703c5ecd7daaf4934c3ae3c2 | https://bundles-staging.storevine.app | upwise-bundles-staging |

- Config: `env.staging` in each `apps/<app>/wrangler.jsonc`; `apps/<app>/shopify.app.staging.toml` (keep scopes, webhooks and proxy in sync with `shopify.app.toml`).
- Deploy: push to the `staging` branch (or run "Staging deploy" manually). `.github/workflows/staging.yml` builds with `CLOUDFLARE_ENV=staging`, deploys the Worker, then releases the staging Shopify config and extensions.
- Staging uses test billing and unlocks paid features for the staging store via `DEV_PLAN_OVERRIDES`.
- Staging apps go on a **separate dev store** (not upwisedev): two apps with the same app-proxy path can't share a store, and keeping stores separate keeps test data apart.

## One-time setup (owner)

1. ✅ **Staging dev store:** Dev Dashboard → Stores → Create store → Dev → tick "Generate test data" → create. Done: dhyanmart-i9ehpjgq.myshopify.com (set in `DEV_PLAN_OVERRIDES`).
2. **Cloudflare API token** (dash.cloudflare.com → My Profile → API Tokens → Create token → "Edit Cloudflare Workers" template; add *Account → D1 → Edit*; zone *storevine.app*). Add GitHub repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (`fcb6b477dfc3113ec91be3f259204dc0`).
3. **Automation tokens:** for each staging app, Dev Dashboard → app → Settings → Create automation token; add as GitHub secrets `SHOPIFY_APP_AUTOMATION_TOKEN_STAGING_CART_UPSELL`, `..._REVIEWS`, `..._POPUPS`, `..._BUNDLES`.
4. Run "Staging deploy" (Actions tab) once. It creates the four staging Workers, databases and domains.
5. **API secrets:** for each staging app, copy its Client secret (Dev Dashboard → app → Settings) into the matching staging Worker as secret `SHOPIFY_API_SECRET` (Cloudflare → Workers → upwise-<app>-staging → Settings → Variables and secrets).
6. **Protected customer data step 1** for each staging app (same selections as production).
7. Install the staging apps on the staging store (Dev Dashboard → app → Install app).
