# Upwise — working notes for Claude

Monorepo for the Upwise family of Shopify apps (Cart Upsell, Reviews, Pop-ups, Bundles).
The plan of record is `docs/blueprint.md`; decisions are logged in its §14.

## Layout
- `apps/cart-upsell` — Shopify React Router app running on Cloudflare Workers (D1 database).
- `packages/platform` — shared code for every app: D1 schema + in-Worker migrations, session table, shop records, webhook idempotency, privacy/compliance handling.

## Rules
- Source of truth: shopify.dev docs/changelog and developers.cloudflare.com. Re-check before platform-dependent work.
- GraphQL Admin API only. Pinned API version: 2026-07 (`API_VERSION` in `app/shopify.server.ts`, `webhooks.api_version` in `shopify.app.toml`). Upgrade quarterly.
- Storefront code only via theme app extensions. No ScriptTag, no theme file edits.
- All charges through Shopify billing. Never build a shop-domain login form.
- Workers runtime: no Node-only libraries; per-request work must stay small; access bindings via `context.cloudflare.env` (use `Route.LoaderArgs`/`Route.ActionArgs` types so context is typed).
- D1 schema changes: append a new migration in `packages/platform/src/migrations.ts` (never edit a shipped one) and mirror it in `schema.ts`.
- Every app must pass the compliance checklist in blueprint §5 before submission.

## Commands (from repo root)
- `npm ci` · `npm run typecheck` · `npm run build` · `npm test` (tests run the built Worker in workerd, so build first)
- Local run: `cd apps/cart-upsell && npm run build && npx wrangler dev -c build/server/wrangler.json --var SHOPIFY_API_KEY:x --var SHOPIFY_API_SECRET:y --var SHOPIFY_APP_URL:http://localhost:8787`
- npm 11 is fine locally; `allowScripts` in root package.json approves workerd/esbuild install scripts.

## Deploy
Push to `main` → Cloudflare Workers Builds (connected to this repo) builds and deploys `apps/cart-upsell`.
Settings: root directory `/`, build command `npm run build -w @upwise/cart-upsell`, deploy command `cd apps/cart-upsell && npx wrangler deploy`.
Secret `SHOPIFY_API_SECRET` is set in the Cloudflare dashboard, never committed.
