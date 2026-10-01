# Shopify App Ecosystem Blueprint — v2.2

**Status:** Working blueprint · **Revised:** 2026-09-30 · **Supersedes:** "7-App Shopify Ecosystem & Cross-Sell Portfolio Blueprint.md" (v1)

This is the operating plan for building, launching and scaling a portfolio of Shopify apps in the Upsell/Cross-sell, Pop-up and Product Review categories under **one brand (Storevine)**, on a **low budget**, hosted on **Cloudflare**. It is written to be built from: every platform rule below was checked against Shopify's official documentation on the revision date, estimates are labelled as estimates, decisions are logged in §14.

---

## 0. What changed

### v2.2 (2026-10-01) — build status

All four apps are built, deployed on Cloudflare and connected to their own Shopify apps. See §12 for per-phase status and `docs/launch-checklist.md` for what's left before App Store submission.

| App | URL | State |
|---|---|---|
| Cart Upsell | cart.storevine.app | Installed on upwisedev; cart offers, offer discounts (Function) and thank-you offers verified end to end |
| Reviews | reviews.storevine.app | Built, tested, deployed; awaiting API secret + install |
| Pop-ups | popups.storevine.app | Built, tested, deployed; awaiting API secret, protected-data approval + install |
| Bundles | bundles.storevine.app | Built, tested, deployed; awaiting API secret + install |

### v2.1 (2026-09-30) — owner decisions applied

| Decision | Effect |
|---|---|
| One brand across all apps — **Storevine** | Names: "Storevine Cart Upsell", "Storevine Reviews", "Storevine Pop-ups", "Storevine Bundles" (§8). Shared look, support site and docs. |
| Post-purchase offers become a **paid plan inside Cart Upsell** | Portfolio is now **4 apps** (§3). Cart Upsell requests post-purchase extension access. |
| Low budget, hosted on **Cloudflare** | Stack is Cloudflare Workers + D1 + KV + Queues + R2 (§6.1). Target fixed cost ≈ $5–$20/month until revenue (§11.5). Paid tools deferred. |
| Partner account created before Aug 1 2021 | $19 App Store registration fee is waived (§11.1). |

### v2 (vs v1)

| Area | v1 | v2 |
|---|---|---|
| Portfolio shape | 7 apps, with separate free and paid copies of Reviews and Pop-ups | Freemium apps per category (§3). Avoids App Store rule 1.1.5 risk and gives one-click upgrades. |
| Storefront delivery | Not specified | **Theme app extensions / app embed blocks only.** ScriptTag creation errors from Oct 1 2026; script tags stop running Mar 1 2027. |
| Checkout pop-ups | Pop-ups via checkout UI extensions | Removed — checkout modals only open on buyer interaction. Pop-ups live on the storefront. |
| Post-purchase | "Checkout UI extension" | **Post-purchase extension** (beta, access request) + **Thank-you page** checkout UI extension targets. |
| Customer data | Not covered | **Protected customer data Level 2** required for Reviews and Pop-ups (§6.9). |
| Speed rule | "Upsell apps must hit p95 ≤500 ms" | That Built for Shopify rule is for carrier-rate apps. Our targets are in §6.12. |
| UI | Polaris (React) | **Polaris web components** + latest App Bridge; Polaris React is deprecated. |
| Functions | "Under 5 ms, mostly Rust" | Instruction-count limits; Rust or JS/TS. Discount Function API + Cart Transform. |
| ASO | Keyword-density and indexing-time claims from mobile ASO blogs | Shopify's own listing limits and rules only (§8). |
| Tax | Build own tax engine for CA SB 122 | Shopify collects/remits tax on app charges where it has presence; own compliance only for off-Shopify income (§11.4). |
| Market data | Jan 2025 figures | Sept 2026 figures (§2.1). |
| Prospecting | Cloudflare as a signal | Removed (Shopify fronts every store with Cloudflare). Better signals in §4.2. |
| New sections | — | Shared platform architecture, build roadmap, KPIs, risk register, decisions, working agreement. |

---

## 1. Executive summary

- **Thesis.** Win merchants with genuinely useful free plans in three high-demand categories, then grow revenue through paid plans and a specialised paid Bundles app that pairs with them. Free is an acquisition channel, not charity: every free plan has a clear, value-based upgrade trigger.
- **Launch order.** Cart Upsell first (most fragmented category — the leader, BOGOS, holds ~21%), then Reviews, then Pop-ups (Privy holds ~82% of stores that run a pop-up app, so we enter with a wedge, not head-on), then Bundles.
- **Engineering model.** One monorepo and one shared platform layer (auth, billing, webhooks, compliance, data, analytics) behind four thin apps, all on Cloudflare's edge. Building app #2 should cost a fraction of app #1.
- **Budget model.** Spend money only where it buys installs or is required. Shopify hosts Functions and extensions for free; Cloudflare Workers Paid is $5/month. Paid tools (StoreLeads, ads, SMS) wait until an app has paying merchants.
- **Quality bar.** Every app is designed to earn **Built for Shopify (BFS)** from day one — it drives ranking, trust and badge placement.
- **Economics.** 0% revenue share on the first $1M lifetime (all associated accounts combined), then 15%, plus a 2.9% processing fee on all billing.

---

## 2. Market and strategy

### 2.1 Market size (third-party, Sept 2026)

| Metric | Value | Source |
|---|---|---|
| Apps on the App Store | ~22,200 (GapQuery, Aug 2026) to ~27,200 (AppNavigator, Sep 2026) | Counts differ by method |
| New apps in last 30 days | ~1,800 | AppNavigator |
| Built for Shopify apps | ~1,700 | AppNavigator |
| Average entry-tier paid plan | ~$86/month | GapQuery |
| Apps with zero reviews | ~58% | GapQuery |
| Live Shopify stores | ~3.1M | StoreLeads |

Implication: the store is crowded but most apps are weak (no reviews, no BFS). A BFS-quality app with steady review velocity stands out.

### 2.2 Category landscape

| Category | Leader(s) | Concentration | Our angle |
|---|---|---|---|
| Upsell / cross-sell | BOGOS ~21%; ReConvert, AfterSell, Rebuy commonly cited | **Fragmented** | Best entry point. Native-feeling cart upsell with a generous free plan; post-purchase as a paid plan in the same app; Bundles as a companion app. |
| Product reviews | Judge.me ~59% of category, on ~20% of all stores | Concentrated | Compete on import-from-anywhere, speed (storefront score impact), and tight integration with Cart Upsell (social proof inside offers). |
| Pop-ups | Privy (Attentive since 2023) ~82% of pop-up-app stores; OptiMonk, Justuno | Very concentrated, but ~95% of stores run no pop-up app | Target the untapped 95% with a lightweight, fast, compliant free tier, not Privy switchers. |

*Share figures are StoreInspect/StoreLeads estimates, not Shopify data.*

### 2.3 Merchant churn and retention

Many new stores close early, which makes free installs from brand-new stores low-value. (Widely quoted figures such as "70% fail in year one" come from vendor blogs — treat as directional.) Practical consequences:

- Measure **cohort retention by merchant plan and store age**, not just total installs.
- Track **Net Revenue Retention (NRR)** monthly: (starting MRR + expansion − contraction − churn) ÷ starting MRR.
- Target monthly paid-logo churn below ~5–7% (industry guidance for SMB SaaS; set our own baseline after 90 days of data).
- Keep free-tier cost per shop near zero so new-store churn doesn't hurt (§6.12, §11.5).

---

## 3. Portfolio architecture (4 apps, one brand)

### 3.1 The apps

| # | App | Category | Model | Free plan | Paid plans | Key Shopify surfaces |
|---|---|---|---|---|---|---|
| 1 | **Storevine Cart Upsell** | Upsell & cross-sell | Freemium | "You may also like" in cart drawer/page, manual rules, limited offers | **Growth:** AI/automatic recommendations, A/B tests, unlimited cart offers, analytics. **Pro:** + one-click **post-purchase offers** and **Thank-you page offers**, funnels, revenue attribution | Theme app extension (app embed + app blocks), AJAX cart / Storefront API, **post-purchase extension** (beta, access request), **checkout UI extension** Thank-you targets, Discount Function, Web Pixels |
| 2 | **Storevine Reviews** | Product reviews | Freemium | Text reviews, star widgets, automated request emails, import | Photo/video reviews, Google Shopping feed, sentiment insights, Q&A, custom widgets | Theme app extension, Flow triggers, R2 for media |
| 3 | **Storevine Pop-ups** | Pop-ups / email capture | Freemium | Email capture, exit intent, basic targeting, newsletter sync | SMS capture, gamified forms, segmentation, A/B tests, integrations | Theme app extension (app embed), Customer Privacy API, customer/segments APIs, Web Pixels |
| 4 | **Storevine Bundles** | Upsell & cross-sell | Paid with free trial (possibly a small free plan) | — | Fixed and mix-and-match bundles, frequently-bought-together, volume/tiered discounts | **Cart Transform Function**, **Discount Function API**, theme app extension, bulk operations for catalog sync |

### 3.2 Why this shape

- **Rule 1.1.5:** an app "must not be identical to other apps you've published." No free/paid copies of the same app.
- **One-click upgrades:** free → Growth → Pro is a plan change inside one app through Shopify billing; no second install, no data migration.
- **Post-purchase in Cart Upsell (decided):** merchants who already trust our cart offers can turn on post-purchase with one plan change; one support surface; attribution across cart and post-purchase in one dashboard. Trade-off: one fewer App Store listing.
- **Bundles stays separate:** technically distinct (Cart Transform, Plus-only `update` operation), different buyer intent ("bundles" is its own search), and not a substitute for Cart Upsell.
- **No revenue-share benefit from splitting:** revenue from all associated developer accounts counts toward one $1M threshold.

### 3.3 Upgrade triggers (free → paid)

| App | Trigger examples |
|---|---|
| Cart Upsell | Attributed revenue above a threshold; more than N active offers; wants AI recommendations, A/B tests, or post-purchase offers |
| Reviews | Wants photo/video; exceeds monthly review-request volume; wants Google Shopping feed |
| Pop-ups | Exceeds monthly impression/sign-up cap; wants SMS or A/B tests |

Show premium features as **disabled and labelled** (a BFS requirement); never as nags. All in-app promotions must be dismissible.

### 3.4 Cross-portfolio integration (compliant)

- One brand makes the family obvious: same visual style, same support site, same account/help docs.
- Each app has an **Integrations** page with real functional links between our apps (e.g., Reviews star ratings inside Cart Upsell offers; Pop-ups sign-ups feeding post-purchase segmentation). Install links go to the App Store listing.
- **Do not** promote related apps from admin blocks/actions/links, Sidekick extensions, checkout extensions or post-purchase extensions (rules 2.2.6, 5.6.2–5.6.3, 5.8.9), and do not reference our other apps in listing text (rule 4.4).
- Shared data between our apps flows through our own backend, keyed by shop, only when each app is installed and with the merchant's consent.

---

## 4. Go-to-market: prospecting and retention

### 4.1 Tools (low-budget sequence)

1. **Months 0–3: free channels only.** App Store organic, Shopify Community answers, a simple brand site with docs and comparison pages, partner directories, YouTube how-to videos.
2. **After first paying merchants:** StoreLeads **Premium $75/mo** for research, or **Pro $250/mo** (CSV export + API) once outbound is worth automating. Enterprise ($950) only if install-history campaigns prove out.
3. **App Store ads** only after an app has ≥10 reviews and ≥4.8 rating (§9).

### 4.2 Useful prospecting signals

- Store has a competitor app in our category installed (especially poorly rated ones) — migration offer with free import.
- Store size proxies: estimated traffic/sales, product count, plan (Plus/Advanced), employee count.
- Theme in use (our extensions tested on it) and region/language.
- *Not useful:* Cloudflare — Shopify serves every storefront through Cloudflare (~99% "adoption").

### 4.3 Retention mechanics

- Onboarding to first value in under 5 minutes (default offer/widget ready on install; deep link to enable the app embed).
- Weekly value email: "Cart Upsell added $X this week."
- Uninstall survey; win-back sequence; data retained per our privacy policy until `shop/redact`.

---

## 5. Compliance checklist (App Store + Built for Shopify)

Treat this as a release gate for every app.

### 5.1 App Store requirements (must pass review)

- [ ] Embedded in admin with the **latest App Bridge** (`app-bridge.js` script tag) — rule 2.2.3
- [ ] **GraphQL Admin API only** (required for new public apps since Apr 1 2025) — rule 2.2.4
- [ ] Install and start from Shopify surfaces; no shop-domain entry; immediate token exchange, no extra sign-up wall
- [ ] **Theme app extensions** for any theme change; no theme-file edits; no ScriptTag
- [ ] **Shopify App Pricing or Billing API** for all charges; no off-platform billing
- [ ] **Compliance webhooks** (`customers/data_request`, `customers/redact`, `shop/redact`) with HMAC verification (401 on invalid), 2xx on valid, actions completed within 30 days
- [ ] Protected customer data access requested at the correct level (§6.9)
- [ ] Not identical to another app we've published — rule 1.1.5
- [ ] No promotion of other apps or review requests on admin blocks/actions, checkout or post-purchase surfaces; no countdown timers in checkout (5.6.6)
- [ ] Listing follows §8 (name, subtitle, no superlatives/stats, no references to our other apps)
- [ ] No incentivised or conditional review requests; neutral language

### 5.2 Built for Shopify (target at launch + 50 installs)

**Eligibility:** ≥50 net installs from active paid-plan shops; ≥5 reviews since launch; 4+ star rating (per the Partner Dashboard BFS checklist, Sep 2026).

**Admin performance** (p75, rolling 28 days, ≥100 calls, measured via App Bridge): LCP ≤2.5 s · CLS ≤0.1 · INP ≤200 ms.

**Storefront:** must not reduce the storefront Lighthouse performance score by more than 10 points.

**Design and UX:**
- Polaris web components; admin nav via `s-app-nav`; Contextual Save Bar on forms; back button on sub-pages; works on mobile
- Primary buttons match Polaris (no green/purple custom primaries); no serif/script font for most content; text meets WCAG 2.1 AA contrast
- Promotions dismissible; premium features shown disabled and labelled; no manipulative tactics (fake timers, guilt messaging, flashing animations)

**Category rules relevant to us:** marketing apps (Pop-ups, Reviews requests) must use **Web Pixels** and **Shopify customer segments**; discount apps (Bundles, Cart Upsell offers with discounts) must use **discount Functions**.

*Carrier-rate apps have a p95 ≤500 ms / ≤0.1% failure rule — not applicable to our portfolio.*

---

## 6. Technical architecture

### 6.1 Stack (Cloudflare, low cost)

| Layer | Choice | Notes |
|---|---|---|
| App framework | **Shopify React Router app template**, adapted to the Cloudflare Workers runtime | TypeScript. React Router 7 supports Workers; Shopify's deploy docs don't cover Workers, so Phase 0 includes a validation spike (§12). |
| Tooling | Shopify CLI + Wrangler; apps created/configured in the **Dev Dashboard** | One Shopify app config (TOML) per app |
| Compute | **Cloudflare Workers Paid ($5/mo)** | Free plan's 10 ms CPU limit and 1K KV writes/day are too tight for OAuth, webhooks and billing. Paid includes 10M requests and 30M CPU-ms/month. |
| Database | **Cloudflare D1** (SQLite at the edge) via **Drizzle ORM** | One D1 database per app per environment; `shop_id` on every table. Paid includes 25B row reads + 50M row writes/month, 5 GB. Time Travel for point-in-time restore. Revisit Postgres (via Hyperdrive) only if an app outgrows D1. |
| Session storage | D1 table (Drizzle) — Shopify's official **`@shopify/shopify-app-session-storage-kv`** as an alternative | Prefer D1 for sessions to avoid KV eventual-consistency surprises on token refresh |
| Cache / config | **Workers KV** | Storefront widget config per shop (read-heavy, served at the edge) |
| Background jobs | **Cloudflare Queues** + **Cron Triggers** | Webhook processing, bulk sync polling, review-request emails, usage reporting |
| File storage | **R2** | Review photos/videos, exports; no egress fees; 10 GB free |
| Admin UI | **Polaris web components** + App Bridge | Polaris React deprecated |
| Checkout/post-purchase UI | Preact + Polaris web components (checkout UI extensions, API 2025-10+) | Hosted by Shopify; run in a Web Worker, no DOM access |
| Storefront UI | Theme app extensions (app embed blocks + app blocks), vanilla JS/Preact, minimal bundle | Hosted on Shopify's CDN — no hosting cost |
| Functions | **Rust** for hot paths (Cart Transform, discounts); JS/TS for simple logic | Hosted and run by Shopify — no hosting cost |
| Email | Low-cost transactional provider with a free tier — **decision pending (§14)** | Review requests, value emails |
| Observability | Workers Logs / Logpush, free-tier error tracking, uptime checks | Access logs retained (Level 2) |
| Environments | Separate Cloudflare environments + D1 databases for staging and production | Also a Level 2 requirement |

### 6.2 Monorepo and shared platform

```
/apps
  cart-upsell/        # React Router app on Workers + theme, post-purchase, checkout UI extensions
  reviews/
  popups/
  bundles/
/packages
  platform-auth/      # token exchange, D1 session storage, scopes
  platform-billing/   # plans, App Pricing / Billing API, usage records, webhooks
  platform-webhooks/  # HMAC verify (Web Crypto), compliance topics, idempotent dispatch to Queues
  platform-graphql/   # typed client, cost-aware throttling, retries, bulk ops helper
  platform-privacy/   # data export/redact jobs, PII field encryption, retention
  platform-analytics/ # attribution, events, Web Pixel helpers
  platform-db/        # Drizzle schema helpers, migrations
  ui/                 # shared Polaris web component patterns (settings, onboarding, plans page) + brand
  storefront-kit/     # tiny shared storefront runtime for theme extensions
/functions            # Rust/JS Shopify Functions
/infra                # wrangler configs, CI/CD (GitHub Actions)
```

Each app is a separate Shopify app (own client ID, scopes, listing) and a separate Worker, sharing packages. A new app reuses auth, billing, webhooks and privacy unchanged.

**Workers-specific rules:** no Node-only libraries without `nodejs_compat`; use Web Crypto for HMAC; keep each request well under CPU limits (offload anything heavy to Queues); respond to webhooks immediately and process via Queues.

### 6.3 Admin API usage and rate limits

- GraphQL Admin API only; pin an API version per release (§6.11).
- **Cost model:** scalars/enums 0, objects 1, mutations 10 by default, connections sized by `first`/`last`. Requested cost is checked before execution; unused cost is refunded.
- **Max single query cost:** 1,000 points.
- **Restore rate by plan:** Standard 100/s · Advanced 200/s · Plus 1,000/s · Enterprise (Commerce Components) 2,000/s.
- Client reads `extensions.cost` and throttles per shop; retry on `THROTTLED` with backoff.
- **Bulk operations** for full-catalog or order-history syncs (Bundles recommendations, Reviews imports). From API **2026-01**: up to **5 concurrent bulk queries and 5 bulk mutations per shop**; operations over 10 days fail. Poll completion with Cron Triggers or the `bulk_operations/finish` webhook; stream the JSONL result into D1 in batches from a Queue consumer.

### 6.4 Storefront (Apps 1, 2, 3, 4)

- Delivered only through **theme app extensions**: app embed blocks (global scripts, pop-ups, cart drawer injection) and app blocks (reviews widget, bundle widget on product pages).
- On install, deep-link the merchant to enable the app embed in the theme editor.
- No ScriptTag (creation/update errors from **Oct 1 2026**, scripts stop running **Mar 1 2027**); Asset API is legacy.
- Widget config served from a Worker backed by KV (edge-cached) or stored in shop/app metafields so the storefront needs no backend call at all where possible.
- Cart reads/writes through the theme's AJAX Cart API or Storefront API.
- Respect consent via the **Customer Privacy API** before tracking or showing marketing pop-ups where required.

### 6.5 Checkout and post-purchase (Cart Upsell Pro plan)

- **Post-purchase extension:** one-click offers between payment and Thank-you page. Still **beta**; live stores require an **access request** for the Cart Upsell app. Any merchant can use App Store apps that include it (custom apps: Plus only). File the request in Phase 0 — critical path.
- **Thank-you / Order status pages:** checkout UI extension targets (all plans; checkout.liquid and Additional Scripts are gone since Aug 2025 for Plus and Aug 26 2026 for non-Plus).
- Checkout UI extensions run in a Web Worker; modals open only on buyer interaction; no countdown timers.
- Gate both features to the Pro plan in the app (check plan server-side before returning offers).
- Analytics via **Web Pixels**, never injected scripts.

### 6.6 Shopify Functions (Cart Upsell, Bundles)

- **Discount Function API** (unified product/order/shipping discounts; old APIs deprecated 2025-04, migration was due before 2026-04).
- **Cart Transform** for bundles: `expand` and `merge` on all plans; `update` only on Plus/dev stores; one cart transform per app per store.
- Limits: 11M instructions (carts ≤200 lines, scales up for larger carts), 256 kB binary, 128 kB input, 20 kB output, input query ≤3,000 bytes and cost ≤30.
- Keep input queries small; precompute in metafields; benchmark with `shopify app function run` against large carts.

### 6.7 Authentication

- Embedded apps use **token exchange** with App Bridge session (ID) tokens; offline tokens for background jobs.
- Minimum scopes per app; request optional scopes only when the feature is enabled.

### 6.8 Webhooks

- Subscribe via app configuration (TOML) where possible.
- Verify HMAC on every request (Web Crypto); return 401 if invalid; enqueue and return 200 immediately; idempotent handlers (dedupe on webhook ID in D1).
- Compliance topics handled by `platform-privacy`; `shop/redact` arrives 48 hours after uninstall — purge all shop data across D1, KV and R2.

### 6.9 Protected customer data

| App | Data | Level |
|---|---|---|
| Reviews | Reviewer name, email (requests), order linkage | **Level 2** |
| Pop-ups | Email, phone (SMS) | **Level 2** |
| Cart Upsell (incl. post-purchase) | Order/customer IDs; avoid storing PII | Level 1 target |
| Bundles | Product/cart data; no PII stored | Level 1 or none |

Level 2 obligations to build in from the start: encryption in transit and at rest (Cloudflare encrypts D1/KV/R2 at rest; add application-level encryption for email/phone fields), encrypted backups (D1 Time Travel + encrypted exports to R2), separated test and production, access logging, least-privilege access (Cloudflare account roles + 2FA), data retention limits, written incident response plan. Request access in the app's configuration before submission.

### 6.10 Billing implementation

- Default to **Shopify App Pricing** (formerly Managed Pricing) for subscription plans, usage pricing and free trials. Use the **Billing API** directly where we need one-time charges or custom logic.
- Usage charges: `cappedAmount` = maximum chargeable per 30-day cycle, approved by the merchant (merchant can change it; listen to `APP_SUBSCRIPTIONS_UPDATE`). Merchants can be billed in local currency.
- Candidates: Pop-ups (sign-ups above cap), Cart Upsell Pro (optional % of post-purchase attributed revenue, capped).

### 6.11 API version policy

- New version every quarter (first day of the quarter, 17:00 UTC); each supported ≥12 months with ≥9 months overlap.
- Upgrade every app to the newest stable version within one quarter of release; never run on the oldest supported version. Review the changelog each quarter.

### 6.12 Performance and cost budgets (our targets, stricter than BFS)

- Storefront: ≤5-point Lighthouse impact; storefront JS ≤30 kB gzipped per app embed; no layout shift; lazy-load below the fold.
- Admin: LCP ≤1.8 s, INP ≤150 ms at p75.
- Backend: p95 ≤300 ms for storefront-facing endpoints (KV/edge cache first).
- Functions: well under instruction limits on 200-line carts.
- **Cost:** free-plan shop should cost < $0.05/month in Cloudflare usage; alert if any shop exceeds 10× the average.
- Load-test before BFCM each year (October).

---

## 7. Design and UI

- Polaris web components and native admin patterns only; settings use Contextual Save Bar; consistent onboarding checklist across all apps (shared `ui` package).
- One brand: shared app icon style, listing screenshot template, help-centre look. Brand colour lives in the icon, listing and storefront widget defaults — **not** in admin primary buttons (BFS).
- One "Plans" page pattern across apps; premium features disabled and labelled.
- Use **Admin Intents** (`shopify.intents.invoke()`) to open native product/collection editors from Bundles and Cart Upsell instead of building our own (optional, saves work).
- Accessibility: WCAG 2.1 AA contrast at minimum; keyboard navigable; storefront widgets screen-reader friendly.

---

## 8. App Store listing and optimisation

Rules from Shopify's requirements and best practices:

- **App name:** ≤30 characters; brand first, optional function word after — fits the one-brand plan: "Storevine Cart Upsell", "Storevine Reviews", "Storevine Pop-ups", "Storevine Bundles". Longest name is "Storevine Cart Upsell" (18 characters). Must be unique and not confusingly similar to another app.
- **Subtitle:** describe value; **no keywords added to improve search**, no "best/first/only", no statistics.
- **Search terms:** up to 5, complete words, one idea each (e.g., "cart upsell", "post purchase upsell").
- **Introduction** 100 characters · **Details** 500 · each **feature** 80.
- Listing must not reference our other apps (the shared brand name does the linking).
- Screenshots and video show the real product in the Shopify admin and storefront.

Process: keep a keyword list per app from App Store search suggestions and competitor listings; change one listing element at a time and track impressions → installs in Partner analytics for 2–4 weeks before the next change. (Shopify publishes no indexing time or keyword-density rule — ignore claims of either.)

---

## 9. App Store ads

- Cost-per-click; daily budgets in USD; placements: search (keyword), category, homepage.
- Ranking combines bid and a **relevance score** (click-through rate, search performance, availability); too-low relevance means the ad can't compete. You pay your bid per click (Shopify docs don't label the auction type).
- **Low-budget rule:** no ads until an app has ≥10 reviews, ≥4.8 rating and a measured free→paid rate. Then a small daily cap on exact-match keywords from proven organic terms; negative keywords for adjacent intents (e.g., "shipping rates").
- Benchmarks (third-party, directional): CPI ~$1.50–$9.00; install-to-paid 2–10%. Kill keywords whose cost per paid merchant exceeds 1/3 of expected 12-month gross margin.

---

## 10. Reviews and legal compliance

- Shopify bans incentivised reviews and withholding features for reviews; requests must be neutral. Shopify detects anomalies and can remove reviews or take action on partner accounts.
- **FTC rule on consumer reviews (16 CFR Part 465, effective Oct 21 2024):** bans fake/AI-generated reviews, reviews conditioned on positive sentiment, undisclosed insider reviews, review suppression, fake social metrics. Civil penalty up to **$53,088 per violation**.
- This applies twice: to how we get reviews of our apps, and to the **Reviews app's product** — it must never let merchants fabricate, suppress or selectively hide reviews in ways that break the rule. Moderation is for abuse/irrelevance, not negativity; "verified buyer" labels must be honest.

---

## 11. Financials

### 11.1 Revenue share

| Profile | Shopify share | Fees |
|---|---|---|
| First $1M lifetime gross app revenue (from Jan 1 2025, all associated accounts combined) | 0% | 2.9% processing + applicable tax |
| Above $1M lifetime | 15% | 2.9% processing + applicable tax |
| >$20M annual app revenue or >$100M company gross revenue | 15% from first dollar | 2.9% processing + applicable tax |

- **$19 registration fee: waived** — our partner account predates Aug 1 2021. Still complete the revenue-share plan registration and declare any associated developer accounts.
- Some countries add **regulatory operating fees of 2–5%**.

### 11.2 Partner referral income (optional)

From Aug 10 2026, partners referring new merchants earn 20% of the subscription fee + 0.1% of eligible online GMV (GMV capped at $100M/yr), each for 4 years. Separate from app revenue share; relevant only if we also run an agency or referral motion.

### 11.3 Unit-economics model (to fill with real data)

| Input | Initial assumption | Replace with |
|---|---|---|
| Installs/month per app (organic) | 50–200 after month 3 | Partner analytics |
| Free → paid conversion | 3–8% | Cohort data |
| ARPU (paid) | $10–$50 depending on app/plan | Billing data |
| Monthly paid churn | 5–7% | Cohort data |
| Infra cost per active shop | <$0.05/month (free), <$0.50 (paid) | Cloudflare bills |
| CAC (ads) | CPI ÷ install-to-paid | Ads data |

Net revenue = gross × (1 − 0.029 − share% − regulatory fee%).

### 11.4 Tax

- **California SB 122** (signed June 29 2026, effective Jan 1 2027) taxes prewritten software including SaaS and digital products; custom software stays exempt.
- **Shopify calculates and remits sales tax on app charges** in jurisdictions where Shopify has a business presence — no own tax engine needed for App Store billing.
- We remain responsible for tax on off-Shopify income, Canadian/BC/Quebec joint election forms, and income tax. Get an accountant's sign-off before first payout.

### 11.5 Low-budget cost plan

| Item | Cost | When |
|---|---|---|
| Cloudflare Workers Paid (covers D1, KV, Queues, Cron included quotas) | $5/month + usage | Phase 0 |
| R2 | Free up to 10 GB | Phase 3 (Reviews media) |
| Domain for brand site/docs | ~$10–15/year (Cloudflare Registrar at cost) | Phase 0 |
| Brand site + help docs | Free (Cloudflare Pages/Workers static assets) | Phase 1 |
| Error tracking, uptime monitoring | Free tiers | Phase 0 |
| Transactional email | Free tier, then usage-based | Phase 3 |
| Shopify dev stores, Functions, extension hosting | Free | Always |
| GitHub (repo + Actions CI) | Free tier | Phase 0 |
| StoreLeads | $75–$250/month | After first paying merchants |
| App Store ads | Small daily cap | After review threshold (§9) |
| SMS provider | Pass-through usage costs, priced into Pop-ups paid plan | Phase 5 |
| Legal docs (privacy policy, terms, DPA) | Template-based initially; lawyer review once revenue allows | Phase 0 |

**Expected fixed cost before revenue: ≈ $5–$20/month.** Agency build estimates in v1 ($18k–$35k per app) don't apply — we build in-house on a shared platform.

---

## 12. Roadmap

| Phase | Weeks | Deliverables | Exit criteria |
|---|---|---|---|
| **0. Foundations** ✅ | 1–3 | Workers spike, monorepo, shared packages, CI/CD, legal pages, domain | Done 2026-09-30. Open: staging apps, trademark check |
| **1. Cart Upsell MVP** ✅ | 4–9 | Offers (D1), resource picker, app embed + cart block, drawer refresh, app-proxy analytics, dashboard, plans, listing draft | Verified on upwisedev 2026-10-01 |
| **2. Launch & learn** | 10–14 | First 50 installs, reviews, support playbook | Not started (needs App Store submission) |
| **3. Cart Upsell Pro** ✅ (partial) | 12–16 | Offer discounts via Discount Function, Pro plan, thank-you page offers | Verified. Post-purchase extension waits for Shopify access approval |
| **4. Reviews** ✅ (built) | 15–22 | Review + star blocks, moderation, CSV import, standard rating metafields | Deployed; install after API secret |
| **5. Pop-ups** ✅ (built) | 22–30 | Accessible pop-up embed, sign-ups → Shopify customers, stats | Deployed; needs protected customer data approval |
| **6. Bundles** ✅ (built) | 28–38 | FBT block, bundle discount Function | Deployed; install after API secret |
| **Ongoing** | — | Quarterly API upgrades, BFCM load tests, listing experiments | — |

If the Workers spike fails a hard requirement, fall back to a single low-cost container host with SQLite/Postgres (Shopify's documented path) and keep R2/KV for storage and caching.

### 12.1 KPIs (reviewed monthly)

Installs, net installs, activation rate (first value within 24 h), free→paid conversion, MRR, NRR, paid churn, review count and rating, BFS status, admin web vitals, storefront Lighthouse impact, support first-response time, Cloudflare cost per active shop, ad CAC per paid merchant.

---

## 13. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| App rejection (duplicate, policy) | Medium | High | §5 checklist as release gate; distinct apps only |
| Post-purchase extension access delayed | Medium | Medium | File in Phase 0; Cart Upsell launches without it; Thank-you offers as partial fallback |
| Shopify libraries incompatible with Workers runtime | Medium | Medium | Phase 0 spike; `nodejs_compat`; fallback host in §12 |
| D1 limits (single-DB size/throughput) | Low early | Medium | One DB per app; archive old analytics to R2; Postgres via Hyperdrive if needed |
| Level 2 data access denied/delayed | Medium | High | Build controls first; document them; minimise PII |
| Losing BFS (performance regression) | Medium | Medium | Performance budgets in CI; synthetic monitoring |
| Competitor dominance (Judge.me, Privy) | High | Medium | Lead with Upsell; differentiate on speed and integration |
| Free-tier cost blowout | Low (edge pricing) | Medium | Caps on free usage; per-shop cost alerts |
| Single-person bus factor / support load | High | Medium | Docs-first support site, canned replies, in-app help |
| Platform deprecations | High (ongoing) | Medium | Quarterly API upgrade policy; changelog review |
| Fake/incentivised review exposure | Low | High | Neutral requests only; audit Reviews app vs FTC rule |
| BFCM outage | Low | High | October load tests; widgets fail silently |

---

## 14. Decisions

### 14.1 Decided

| Date | Decision | Reason |
|---|---|---|
| 2026-09-30 | One brand across all apps | Shared trust and recognition; listing rules forbid naming our other apps, so the brand does the linking |
| 2026-09-30 | Post-purchase offers = paid plan inside Cart Upsell; portfolio = 4 apps | One-click upgrade, one support surface, combined attribution |
| 2026-09-30 | Low budget; host on Cloudflare (Workers, D1, KV, Queues, R2) | ~$5/month base, edge performance for storefront widgets, no egress fees |
| 2026-09-30 | Use existing pre-2021 partner account | $19 registration fee waived |
| 2026-09-30 | Brand name: **Upwise** | Short (6 chars), suggests upsell + smart recommendations, fits all four app names; no Shopify app conflict found. Pending: domain, USPTO (classes 9, 42), App Store and social-handle checks |
| 2026-09-30 | Cart Upsell set to **public (App Store) distribution** | Required for the Billing API; permanent; nothing is listed until the app is submitted for review |
| 2026-09-30 | Domain **upwise.dev** (Cloudflare Registrar). Apps live on subdomains: `cart.upwise.dev` (Cart Upsell, live), later `reviews.`, `popups.`, `bundles.`; apex reserved for the brand site + help docs | One brand, one zone; Cloudflare issues DNS + certificates on deploy |
| 2026-10-01 | Post-purchase access request moved to Phase 3 | Only needed for live stores; dev-store testing works without it |
| 2026-10-01 | Dev-only `DEV_PLAN_OVERRIDES` to test paid features on upwisedev | Avoids accepting test-charge terms on the owner's behalf; must be empty before launch |
| 2026-10-01 | Shared `packages/shopify-app` for Reviews, Pop-ups, Bundles | Each new app is mostly feature code; one place for auth, webhooks, billing |
| 2026-10-01 | Reviews default to hold-for-approval; Pop-ups never re-subscribe unsubscribed customers | Spam and consent safety (independent review findings) |
| 2026-09-30 | **Phase 0 spike passed** on Cloudflare Workers | Live at cart.upwise.dev (fallback upwise-cart-upsell.akjr004.workers.dev); D1 auto-provisioned + in-Worker migrations; install/token exchange, Admin GraphQL, session storage and Billing API test charge verified on upwisedev; HMAC-verified compliance webhooks pass end-to-end tests in workerd; config released to Shopify from GitHub Actions |
| 2026-10-01 | **Rebrand: Upwise → Storevine** (Upwise is trademark-protected). Domain **storevine.app**; apps on `cart.`, `reviews.`, `popups.`, `bundles.storevine.app` | Name checked against the App Store, app stores and web (no conflicts; storevine.com is parked for sale). "Upcartley" rejected: too close to three existing "Upcart" cart-upsell apps. USPTO search still to do before launch |
| 2026-10-01 | Rebrand covers everything merchants or shoppers can see (app names, URLs, legal pages, emails, storefront CSS/JS, line properties, proxy subpaths, metafield namespaces, extension handles, customer tag, branding). Internal names stay `upwise` (Worker and D1 names, npm scope `@upwise/*`, repo, dev store upwisedev) | Renaming Workers or D1 would mean new Cloudflare projects and empty databases for no user-visible gain |

### 14.2 Still open

1. **Storevine trademark + social handles** (domain done: storevine.app). USPTO search classes 9 and 42.
2. **Pricing** for each plan (draft after competitor review in Phase 1).
3. **Email provider** for review requests and value emails; **SMS provider** for Pop-ups (later).
4. **Legal entity and country** (affects tax forms and regulatory fees).
5. **Team:** solo + Claude, or occasional contractors for design/support.

---

## 15. Working agreement (for building with Claude)

- **Source of truth:** shopify.dev docs and changelog, and developers.cloudflare.com for hosting. Re-check current docs before implementing any platform-dependent feature; record changes in §0.
- **API version:** pin the newest stable version at the start of each phase (2026-10 ships Oct 1 2026); upgrade quarterly.
- **Definition of done** for any feature: passes the §5 items it touches, meets §6.12 budgets, has tests, works on mobile admin, handles uninstall/redact, runs within Workers limits.
- **Decisions log:** add every major decision to §14.1 with date and reason.
- **Keep this blueprint current:** update after each phase.

---

## Sources

Official Shopify:
- Built for Shopify requirements — https://shopify.dev/docs/apps/launch/built-for-shopify/requirements
- App Store requirements — https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements
- App Store best practices — https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices
- Deploy to a hosting service — https://shopify.dev/docs/apps/launch/deployment/deploy-to-hosting-service
- KV session storage adapter — https://www.npmjs.com/package/@shopify/shopify-app-session-storage-kv
- Script tag deprecation — https://shopify.dev/changelog/online-store-script-tags-deprecation
- Asset API (legacy) — https://shopify.dev/docs/apps/build/online-store/asset-legacy
- GraphQL Admin rate limits — https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits
- Bulk operations — https://shopify.dev/docs/api/usage/bulk-operations/queries
- API versioning — https://shopify.dev/docs/api/usage/versioning
- Function APIs — https://shopify.dev/docs/api/functions
- Function languages — https://shopify.dev/docs/apps/build/functions/programming-languages
- Discount Function API migration — https://shopify.dev/changelog/deprecation-product-order-shipping-discount-function-apis
- Cart Transform — https://shopify.dev/docs/api/functions/latest/cart-transform
- Checkout UI extensions — https://shopify.dev/docs/api/checkout-ui-extensions
- Checkout modal — https://shopify.dev/docs/api/checkout-ui-extensions/latest/web-components/overlays/modal
- Post-purchase offers — https://shopify.dev/docs/apps/build/checkout/product-offers/build-a-post-purchase-offer
- Thank-you/Order status upgrade — https://help.shopify.com/en/manual/checkout-settings/checkout-extensibility/checkout-upgrade/upgrade-thank-you-order-status
- Scripts deprecation — https://shopify.dev/changelog/shopify-scripts-will-be-deprecated-on-june-30-2026
- Privacy law compliance — https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
- Protected customer data — https://shopify.dev/docs/apps/launch/protected-customer-data
- App Home / Polaris web components — https://shopify.dev/docs/api/app-home
- Polaris React (deprecated) — https://polaris-react.shopify.com/
- Admin intents — https://shopify.dev/docs/apps/build/admin/admin-intents
- Dev Dashboard migration — https://shopify.dev/docs/apps/build/dev-dashboard/migrate-from-partners
- React Router template — https://github.com/Shopify/shopify-app-template-remix
- Billing — https://shopify.dev/docs/apps/launch/billing
- Shopify App Pricing — https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing
- Usage-based subscriptions — https://shopify.dev/docs/apps/launch/billing/subscription-billing/create-usage-based-subscriptions
- Revenue share — https://shopify.dev/docs/apps/launch/distribution/revenue-share
- Associated accounts — https://help.shopify.com/en/partners/manage-account/associated-accounts
- Partner sales taxes — https://help.shopify.com/en/partners/partner-program/sales-taxes
- Partner earning model — https://www.shopify.com/partners/blog/a-new-partner-earning-model
- How partners earn — https://help.shopify.com/en/partners/partner-program/how-to-earn
- App Store ads — https://shopify.dev/docs/apps/launch/marketing/advertising/start-advertising

Cloudflare:
- Workers pricing (incl. D1, KV, Queues, R2) — https://developers.cloudflare.com/workers/platform/pricing/

Community references (Shopify apps on Workers):
- devkindhq/shopify-on-cloudflare — https://github.com/devkindhq/shopify-on-cloudflare
- gruntlord5/cloudflare-worker-shopifyd1 — https://github.com/gruntlord5/cloudflare-worker-shopifyd1
- Deploying the Shopify template to Workers (Ilias Haddad) — https://iliashaddad.com/blog/deploy-the-shopify-remix-official-template-to-cloudflare-workers

Third-party data:
- AppNavigator statistics — https://appnavigator.io/statistics/
- GapQuery statistics — https://www.gapquery.com/shopify-app-store-statistics
- StoreInspect market share — https://storeinspect.com/blog/shopify-app-market-share
- StoreInspect pop-up apps — https://storeinspect.com/blog/best-shopify-popup-apps
- StoreLeads Shopify report — https://storeleads.app/reports/shopify
- StoreLeads Cloudflare report — https://storeleads.app/reports/technology/Cloudflare
- StoreLeads pricing (ColdIQ) — https://coldiq.com/blog/storeleads-pricing
- PwC on CA SB 122 — https://www.pwc.com/us/en/services/tax/library/california-imposes-sales-and-use-tax-on-digital-products-and-saas.html
- FTC review rule summary (Goodwin) — https://www.goodwinlaw.com/en/insights/publications/2024/09/alerts-practices-cldr-ftc-finalizes-rule-on-consumer-reviews
- FTC civil penalty amounts — https://www.ecfr.gov/current/title-16/chapter-I/subchapter-A/part-1/subpart-L/section-1.98
