# Security incident response policy — Storevine apps

Owner: Rahul Dhyani (Karj Trading LLC), the only person with access to Storevine systems.
Applies to: Storevine Cart Upsell, Reviews, Pop-ups and Bundles, their Cloudflare Workers, D1 databases, R2 bucket, GitHub repository and Shopify Partner apps.
Reviewed: 2026-10-03. Review again every 12 months or after any incident.

## 1. What counts as an incident
- Someone gets, or may have got, unauthorised access to a Storevine account (Cloudflare, GitHub, Shopify Partners, email) or to a secret (`SHOPIFY_API_SECRET`, automation tokens).
- Customer or merchant data is exposed, changed or deleted without authorisation.
- A code change or dependency causes data to be sent somewhere it shouldn't go.
- A report from Shopify, a merchant or a researcher about any of the above (privacy@storevine.app).

## 2. Contain (within 1 hour of noticing)
1. Rotate affected secrets: Shopify API secret (Partner Dashboard → app → API credentials, then update the Worker secret), GitHub automation tokens, Cloudflare API tokens.
2. Revoke sessions and reset passwords on affected accounts; confirm 2FA is on.
3. If a deploy caused it, roll back the Worker in Cloudflare (Deployments → previous version) and revert the commit.
4. If needed, disable the affected app's storefront features (turn off the app embed setting) or pause the Worker route.

## 3. Assess (within 24 hours)
- Use Cloudflare audit logs and Workers Logs to find what was accessed, when, and for which shops.
- List affected shops and data types (for example: review-request emails and first names in Reviews).

## 4. Notify
- **Shopify:** report to Shopify Partner support without undue delay, and in any case within the time Shopify's Partner Program Agreement and API terms require.
- **Merchants:** email affected merchants (shop email from the Admin API) with what happened, what data, and what we did.
- **Regulators:** where GDPR or similar law applies and personal data was exposed, notify the relevant authority within 72 hours of becoming aware, and affected individuals when required (the merchant is usually the controller; we support their notifications).

## 5. Recover
- Restore data from D1 Time Travel if it was altered or deleted.
- Fix the root cause, add a test, and redeploy through CI.

## 6. Learn
- Write a short post-incident note in `docs/security/incidents/` (date, impact, cause, fix, follow-ups) within 7 days.
