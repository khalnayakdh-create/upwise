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

## 5. Webhook config
Webhook subscriptions (including the three privacy topics) are defined in `shopify.app.toml`. Release them with `shopify app deploy` (Shopify CLI, from `apps/cart-upsell`), or enter them in the Dev Dashboard app version form.
