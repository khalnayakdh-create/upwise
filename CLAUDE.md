# Storevine — working notes for Claude

Monorepo for the Storevine family of Shopify apps (Cart Upsell, Reviews, Pop-ups, Bundles).
The plan of record is `docs/blueprint.md`; decisions are logged in its §14.

## Layout
- `apps/cart-upsell` — Storevine Cart Upsell (cart.storevine.app): cart offers, offer discounts (Function), thank-you offers (checkout UI ext).
- `apps/reviews` — Storevine Reviews (reviews.storevine.app): review widget + star rating blocks, moderation, CSV import, standard reviews.rating metafields.
- `apps/popups` — Storevine Pop-ups (popups.storevine.app): email sign-up pop-up embed; sign-ups saved as Shopify customers (protected customer data).
- `apps/bundles` — Storevine Bundles (bundles.storevine.app): frequently-bought-together block + bundle discount Function.
- `packages/platform` — D1 schema + in-Worker migrations, sessions, shop records, webhook idempotency, privacy/compliance.
- `packages/shopify-app` — shared Shopify app factory (Workers adapter, billing), entry.server, shared webhook/health routes, Admin helpers, save bar.
- `scripts/new-app.sh` — scaffolds a new app on the shared packages.
- Internal names intentionally still say `upwise` (Worker + D1 names, npm scope `@upwise/*`, repo, dev store `upwisedev`). Everything merchants or shoppers see says Storevine. Don't reintroduce "Upwise" in user-visible text (trademark).
- Each app: its own Shopify app (Dev Dashboard), Worker, D1 database, subdomain, app-proxy subpath, automation-token secret.

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
Push to `main` → Cloudflare Workers Builds (one project per app, connected to this repo) builds and deploys.
Per app: root directory `/`, build command `npm run build -w @upwise/<app>`, deploy command `cd apps/<app> && npx wrangler deploy`.
Shopify config/extensions: `.github/workflows/shopify-deploy.yml` (matrix; secret `SHOPIFY_APP_AUTOMATION_TOKEN_<APP>`).
Secret `SHOPIFY_API_SECRET` is set per Worker in the Cloudflare dashboard, never committed.
`DEV_PLAN_OVERRIDES` (wrangler vars) unlocks paid features on upwisedev only — must be empty before launch (docs/launch-checklist.md).
