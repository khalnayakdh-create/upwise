# Launch checklist — Upwise Cart Upsell

Before submitting for App Store review / switching to production billing:

- [ ] `DEV_PLAN_OVERRIDES` is empty in `apps/cart-upsell/wrangler.jsonc`
- [ ] `BILLING_TEST_MODE` is `"false"`
- [ ] Final plan prices set in `app/lib/plans.ts` (currently placeholders: Growth $9.99, Pro $24.99)
- [ ] `privacy@upwise.dev` and `support@upwise.dev` forward to a monitored inbox (Cloudflare Email Routing)
- [ ] Privacy policy and terms reviewed by a lawyer
- [ ] Listing copy + screenshots from `docs/listing/cart-upsell.md`
- [ ] App icon (1200×1200) uploaded in Dev Dashboard
- [ ] Separate staging app + Worker created; production uses its own D1 database
- [ ] Compliance checklist (blueprint §5) re-run
- [ ] Post-purchase extension access requested (Phase 3, live stores only)
