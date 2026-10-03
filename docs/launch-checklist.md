# Launch checklist — all Storevine apps

Run for **each** app (cart-upsell, reviews, popups, bundles) before submitting it for App Store review.

## Configuration (apps/<app>/wrangler.jsonc)
- [ ] `DEV_PLAN_OVERRIDES` is `""` (it unlocks paid features on upwisedev)
- [ ] `BILLING_TEST_MODE` is `"false"` (otherwise real merchants get free test subscriptions)
- [x] Final plan prices set in `app/lib/plans.ts` (approved 2026-10-03, blueprint §14.2.1)
- [ ] App set to **public distribution** in the Dev Dashboard (required for the Billing API)

## Shopify
- [ ] Automation-token secret added to GitHub and "Shopify app config" workflow succeeded
- [ ] App icon (1200×1200) uploaded; listing copy + screenshots ready (see docs/listing/)
- [ ] Compliance checklist (blueprint §5) re-run; protected customer data request approved where needed (Pop-ups: email)
- [ ] Cart Upsell only: post-purchase extension access requested (only needed for live stores)

## Business
- [ ] `privacy@storevine.app` and `support@storevine.app` forward to a monitored inbox (Cloudflare Email Routing)
- [ ] Privacy policies and terms reviewed by a lawyer
- [ ] "Storevine" trademark search done (USPTO classes 9, 42)
- [ ] Staging environment finished (`docs/staging.md`): staging apps, Workers, D1, dev store; all testing moves there
