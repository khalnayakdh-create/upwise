# Submission readiness — all four Storevine apps

Status on 2026-10-03, checked against blueprint §5.1 (App Store requirements) and `docs/launch-checklist.md`.
✅ done and verified · 🟡 partly done · ⬜ not started. **Owner** = only Rahul can do it (accounts, legal, approvals).

## App Store requirements (blueprint §5.1)

| Requirement | Cart Upsell | Reviews | Pop-ups | Bundles |
|---|---|---|---|---|
| Embedded with App Bridge, `s-app-nav` | ✅ | ✅ | ✅ | ✅ |
| GraphQL Admin API only | ✅ | ✅ | ✅ | ✅ |
| Install from Shopify, no shop-domain form, token exchange | ✅ | ✅ | ✅ | ✅ |
| Theme app extensions only (no ScriptTag, no theme edits) | ✅ | ✅ | ✅ | ✅ |
| All charges through Shopify billing | ✅ | ✅ | ✅ | ✅ |
| Compliance webhooks with HMAC (401 bad / 2xx good), data deleted on shop/redact | ✅ tested | ✅ tested (incl. photos) | ✅ tested | ✅ tested |
| Protected customer data, step 1 (data use) | ✅ orders | ✅ orders, email | ✅ customers | ✅ orders |
| Protected customer data, step 2 (data protection details) | ⬜ Owner | ⬜ Owner | ⬜ Owner | ⬜ Owner |
| Not identical to another of our apps (1.1.5) | ✅ | ✅ | ✅ | ✅ |
| No review requests or app promotion in admin blocks, checkout or thank-you | ✅ | ✅ admin block shows data only | ✅ | ✅ |
| Listing copy within limits, no superlatives or cross-app mentions | ✅ `docs/listing/cart-upsell.md` | ✅ `docs/listing/reviews.md` | ✅ `docs/listing/popups.md` | ✅ `docs/listing/bundles.md` |
| Neutral, non-incentivised review requests (Reviews product) | — | ✅ FTC wording, every rating welcome | — | — |
| Privacy policy and terms pages live | ✅ | ✅ | ✅ | ✅ |
| Accessibility (WCAG 2.2 AA pass) and translations (locale files) | ✅ | ✅ | ✅ | ✅ |
| Storefront script under 10 KB | ✅ 8.1 KB | ✅ 5.5 KB | ✅ 5.4 KB | ✅ 9.2 KB |
| Final prices | ✅ $14.99 | ✅ $9.99 | ✅ $9.99 | ✅ $19.99 |

## Before pressing "Submit" (in this order)

1. ⬜ **Owner:** in the Partner Dashboard, for each app, complete **protected customer data step 2** (data protection details). Claude can draft the answers from the code (encryption, retention, deletion, access logs) on request.
2. ⬜ **Owner:** set each app to **public distribution** in the Dev Dashboard (needed for real billing).
3. ⬜ **Owner:** set up **support@storevine.app** and **privacy@storevine.app** forwarding to a monitored inbox (Cloudflare Email Routing on storevine.app).
4. ⬜ **Owner:** upload a 1200×1200 icon per app. Claude can draft icons.
5. ⬜ Screenshots (1600×900) per app from upwisedev; lists are in each `docs/listing/*.md`. Claude can capture these.
6. ⬜ **Owner:** lawyer review of privacy policies and terms; USPTO trademark search for "Storevine" (classes 9 and 42).
7. ⬜ At submission time, per app: empty `DEV_PLAN_OVERRIDES` and set `BILLING_TEST_MODE` to `"false"` in `wrangler.jsonc`, then confirm upwisedev shows the Free plan. (Do this last; it locks paid features on the dev store.)
8. ⬜ Cart Upsell only: request post-purchase extension access if we add a post-purchase page later (not needed today).

## Built for Shopify (after launch)

Needs 50 net paid installs and 5 reviews per app, then admin Web Vitals (LCP ≤2.5 s, CLS ≤0.1, INP ≤200 ms) and storefront Lighthouse impact ≤10 points. Marketing apps (Pop-ups, Reviews requests) must also use Web Pixels and customer segments: not built yet.
