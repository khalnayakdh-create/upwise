# Setup and deploy — Upwise Cart Upsell

## 1. Cloudflare (one time)
1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository** → pick `khalnayakdh-create/upwise`.
2. Settings:
   - Project name: `upwise-cart-upsell` (must match `name` in `apps/cart-upsell/wrangler.jsonc`)
   - Root directory: `/`
   - Build command: `npm run build -w @upwise/cart-upsell`
   - Deploy command: `cd apps/cart-upsell && npx wrangler deploy`
3. Deploy. The D1 database `upwise-cart-upsell` is created automatically; tables are created on the first request.
4. Open `https://upwise-cart-upsell.<your-subdomain>.workers.dev/healthz` → should show `"ok": true`.

## 2. Shopify app (one time)
1. Dev Dashboard → **Create app** → name **Upwise Cart Upsell**.
2. App URL: `https://upwise-cart-upsell.<subdomain>.workers.dev`
   Redirect URL: `https://upwise-cart-upsell.<subdomain>.workers.dev/auth/callback`
   Scopes: `read_products`. Embedded: yes. Webhooks API version: `2026-07`.
3. Copy the **Client ID** and **Client secret**.

## 3. Connect the two
- Put the Client ID in `apps/cart-upsell/wrangler.jsonc` → `vars.SHOPIFY_API_KEY`, and the Worker URL in `vars.SHOPIFY_APP_URL`; fill the `FILL` values in `shopify.app.toml`. Commit → auto-deploys.
- Cloudflare → Worker → **Settings → Variables and Secrets** → add secret `SHOPIFY_API_SECRET` = Client secret.
- `/healthz` should now show apiKey, apiSecret and appUrl configured.

## 4. Install on the dev store
Dev Dashboard → app → **Install on dev store** → `upwisedev`. The app home should show the "Setup check" card.
Then test: Plans → start Growth test subscription → approve → cancel. Uninstall and reinstall once.

## 5. Webhook config (automated)
Webhook subscriptions (including the three privacy topics) live in `apps/cart-upsell/shopify.app.toml`.
The **Shopify app config** GitHub Action releases them whenever that file changes. One-time setup:
1. Dev Dashboard → Upwise Cart Upsell → Settings → **App automation token** → Create.
2. GitHub → `upwise` repo → Settings → Secrets and variables → Actions → New secret
   `SHOPIFY_APP_AUTOMATION_TOKEN_CART_UPSELL` = the token.
3. GitHub → Actions → "Shopify app config" → Run workflow.

## All apps

| App | URL | Client ID | Worker | Automation-token secret |
|---|---|---|---|---|
| Cart Upsell | https://cart.upwise.dev | 3e6e2d418655b16b1d9132a533b68a00 | upwise-cart-upsell | SHOPIFY_APP_AUTOMATION_TOKEN_CART_UPSELL |
| Reviews | https://reviews.upwise.dev | 32a320dfc76c417d383e39d124f8405c | upwise-reviews | SHOPIFY_APP_AUTOMATION_TOKEN_REVIEWS |
| Pop-ups | https://popups.upwise.dev | 6b1ae04f6ae8a893a38a2fe7b8d4da8b | upwise-popups | SHOPIFY_APP_AUTOMATION_TOKEN_POPUPS |
| Bundles | https://bundles.upwise.dev | d1c8b13293b07718447b5f039c8e455a | upwise-bundles | SHOPIFY_APP_AUTOMATION_TOKEN_BUNDLES |

For each new app: (1) Cloudflare → Worker → Settings → Variables and Secrets → add secret `SHOPIFY_API_SECRET` (Client secret from the Dev Dashboard); (2) Dev Dashboard → app → Settings → App automation token → add it as the GitHub repo secret above; (3) GitHub → Actions → "Shopify app config" → Run workflow; (4) install on upwisedev via `https://<app-url>/auth/login?shop=upwisedev.myshopify.com`.
Pop-ups also needs **protected customer data** access (Dev Dashboard → API access → Protected customer data: Level 1 + Level 2 email) before sign-ups can be saved.

## Current values (Cart Upsell)
- App URL: https://cart.upwise.dev (fallback: https://upwise-cart-upsell.akjr004.workers.dev)
- Shopify Client ID: 3e6e2d418655b16b1d9132a533b68a00 (public; the secret lives only in Cloudflare)
- Dev store: upwisedev
