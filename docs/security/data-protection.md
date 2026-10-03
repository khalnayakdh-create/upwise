# Protected customer data — step 2 answers (draft)

For the Partner Dashboard: each app → API access requests → Protected customer data → "Provide your data protection details".
Requirement wording is from https://shopify.dev/docs/apps/launch/protected-customer-data (checked 2026-10-03). The form's exact wording isn't published; match each answer to the closest question.

Only answer "yes" where the evidence column is true today. Items marked **⚠ Owner** must be done or confirmed by you before answering yes.

## Which level each app needs

| App | Customer data it touches | Fields | Level |
|---|---|---|---|
| Cart Upsell | `orders/create`, `refunds/create` webhooks | None stored. Keeps order ID, amounts of offer items, order subtotal, refunds, holdout group | **1** |
| Bundles | `orders/create` webhook | None stored. Keeps order ID and bundle line amounts | **1** |
| Reviews | `orders/fulfilled` webhook | **Email, first name** (kept until the request is handled, then erased after 60 days) | **2** |
| Pop-ups | Creates/updates Shopify customers from storefront sign-ups | **Email** (passed straight to Shopify; Storevine stores none) | **2** |

Field reasons (free text) to paste:
- Reviews, email: "To send one review-request email per fulfilled order, when the merchant turns requests on."
- Reviews, name: "To greet the customer by first name in the review-request email."
- Pop-ups, email: "To save storefront sign-ups as Shopify customers subscribed to email marketing, with consent."

## Level 1 requirements (all four apps)

| # | Requirement | Answer | Evidence |
|---|---|---|---|
| 1 | Process only the minimum personal data required | Yes | Cart Upsell and Bundles store no customer fields. Reviews keeps email + first name only, then erases them 60 days after the request is handled (`eraseExpiredRequestData`, daily cron). Pop-ups stores nothing. |
| 2 | Inform merchants what personal data you process and why | Yes | Privacy policy per app at `https://<app>.storevine.app/legal/privacy` lists data and purpose. |
| 3 | Limit processing to the stated purposes | Yes | Data is used only for the features above; no analytics resale, no cross-app sharing (each app has its own database). |
| 4 | Respect and apply customer consent decisions | Yes | Pop-ups requires a ticked consent box, never re-subscribes someone who unsubscribed, and saves a consent record on the customer. Reviews honours one-click unsubscribe (stored as a one-way hash). Cart Upsell's holdout test follows Shopify's Customer Privacy analytics choice. |
| 5 | Respect opt-out of data sharing ("data sale") | Not applicable | No customer data is sold or shared with third parties. |
| 6 | Opt-out for automated decisions with legal or significant effects | Not applicable | No such decisions. The holdout test only hides product suggestions. |
| 7 | Privacy and data protection agreements with merchants | Yes | Terms of service (`/legal/terms`) and privacy policy per app. **⚠ Owner:** lawyer review pending (launch checklist). |
| 8 | Apply retention periods | Yes | Reviews: request emails and names erased 60 days after handling; all data deleted on `shop/redact`; `customers/redact` deletes that customer's requests. Other apps hold no customer fields; all shop data deleted on `shop/redact`. |
| 9 | Encrypt data at rest and in transit | Yes | Cloudflare D1 and R2 encrypt all stored objects with AES-256 (D1 docs: "All objects stored in D1, including metadata, live databases, and inactive databases are encrypted at rest"). All traffic uses TLS (HTTPS only; Shopify webhooks and app proxy over HTTPS). |

## Level 2 requirements (Reviews and Pop-ups)

| # | Requirement | Answer | Evidence / action |
|---|---|---|---|
| 10 | Encrypt data backups | Yes | D1 point-in-time recovery (Time Travel) is stored by Cloudflare under the same at-rest encryption; no other backups or exports of customer data are made. |
| 11 | Keep test and production data separate | **⚠ Not yet** | Today the dev store uses the production Workers and databases. Before submitting: create staging Shopify apps + Workers + D1 databases for testing (launch checklist item). Claude can set these up. |
| 12 | Have a data loss prevention strategy | Yes, once 11 and 13–14 are done | Minimal data held; no customer-data exports; secrets only in Cloudflare/GitHub encrypted secrets; HMAC-verified webhooks; deletion on redact; D1 Time Travel for recovery. |
| 13 | Limit staff access | Yes | Only the owner has access to Cloudflare, GitHub, Shopify Partners. No contractors. **⚠ Owner:** confirm no other members on those accounts. |
| 14 | Require strong passwords for staff accounts | **⚠ Owner** | Turn on two-factor authentication for Cloudflare, GitHub and Shopify Partners, and use a password manager. Answer yes once done. |
| 15 | Keep an access log to protected customer data | Yes | Cloudflare account audit logs (dashboard/API access) and Workers Logs for every request that reads or writes customer data. **⚠ Owner:** keep audit logs enabled (default). |
| 16 | Implement a security incident response policy | Yes | `docs/security/incident-response.md`. |

## To finish before answering

1. ⚠ Owner: 2FA on Cloudflare, GitHub and Shopify Partners (item 14); confirm sole access (13).
2. Staging environment for testing (item 11) — Claude can build it: separate Shopify apps, Workers and D1 databases, and point the dev store at staging.
3. ⚠ Owner: lawyer review of terms and privacy policies (item 7).
