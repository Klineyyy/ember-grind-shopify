# App decisions

## 1. Store concept — Ember & Grind

**Ember & Grind** is a fictional small-batch specialty coffee roaster that sells roasted beans online (whole bean or ground to order) plus a little brewing gear.

The customer problem it designs for: specialty coffee is confusing. Words like *washed*, *natural*, *light roast* or *Yirgacheffe* don't tell a shopper whether they'll enjoy the bag, so people buy the wrong coffee, or the wrong grind for their brewer, and don't come back.

The theme answers that with three ideas:

- **Brew Profile quiz (the standout feature).** Five questions (brewer, flavour preference, milk, caffeine, grinder). Every coffee is scored 0–100 on the client from three weighted parts — flavour fit (55%, distance between the shopper's target and the coffee's `flavor_profile` metafield), roast fit (25%, ideal roast for that brewer, nudged darker for milk drinkers) and brew-method fit (20%) — plus caffeine rules. Each result shows **why** it matched (“Nails your bright & fruity profile”, “Stands up to milk”), picks the right **grind** variant for the brewer, suggests matching **gear**, and lets the shopper add one coffee or all three as a **15%-off sampler** in one Cart API call.
- **Make coffee legible.** Roast meter on every card, tasting-note chips, a flavour **radar chart** rendered server-side in Liquid/SVG, an origin map of the farms, and a brew guide with recipes per method.
- **Brand.** Warm crema/charcoal/ember palette, Fraunces + Inter, a scroll-driven “roast” hero, and generated packshots where every bag has its own colour and label.

Theme constraints respected: Liquid + CSS + minimal vanilla JS (four small files, no framework), Online Store 2.0 JSON templates, every custom section is configurable in the theme editor, the cart drawer is re-rendered via the Section Rendering API so Liquid stays the single source of markup.

## 2. App idea — Restock Radar

**Problem.** A roaster sells the same products every week and can't afford to run out: green coffee takes weeks to arrive, so a stockout on a best-seller means weeks of lost sales. Shopify shows *how many* units are left, but not whether that is *enough*, or what to order, or when. Small merchants reorder from gut feel and spreadsheets.

**What the app does.**

1. **Scores stockout risk** for every tracked variant (0–100, tiered critical / high / watch / healthy, plus overstock and no-demand), using sales velocity, stock, supplier lead time, units already on order and revenue importance.
2. **Explains every score** — the product page lists the points each factor contributed, so the merchant can trust (or argue with) the recommendation.
3. **Recommends what to order and by when** — quantity rounded to the supplier's minimum order quantity, an *order-by* date, and the projected stockout date.
4. **Turns recommendations into work.** One click creates draft restock plans (purchase orders), **grouped by supplier**, skipping anything already on an open plan. Plans move through a strict state machine (draft → ordered → received / cancelled); ordered units count as incoming stock (so risk drops immediately), and receiving can push the units into Shopify inventory.
5. **Alerts** open, escalate and auto-resolve as conditions change (stockout risk, out of stock, sales spike, overstock).
6. **History** — an activity log of every change with field-level diffs, append-only score history (sparklines), inventory snapshots and daily sales.
7. **The other side of the coin:** cash tied up in overstock and products with stock but no demand.

It is not CRUD with a dashboard on top: the core of the app is a decision (“what should I reorder today?”) and a workflow to act on it.

### The scoring model (`app/web/src/server/services/riskEngine.ts`)

```
velocity       = 0.6 × avg(last 7 days) + 0.4 × avg(last 30 days)      (reacts to spikes, damped)
days of cover  = (available + incoming on open POs) / velocity
cover target   = lead time + safety stock days

score = cover risk    0–70   70 × clamp((1.5 − cover/target), 0, 1)   — 0 at ≥150% of target, 70 at ≤50%
      + trend risk    0–15   week-over-month velocity ratio 1.0 → 1.5
      + revenue impact 0–15  revenue percentile in the shop (only when cover is actually at risk)

recommended qty = ceil(velocity × (lead + review period + safety) − available − incoming), rounded up to MOQ
order-by date   = today + (days of cover − cover target)
```

It is a pure function with 14 unit tests (spikes, zero velocity, incoming POs, MOQ rounding, overstock, ties in revenue ranking). Weights and thresholds are named constants so they are easy to tune.

## 3. Architecture

```
Shopify Admin (iframe)                        Storefront (theme) ── orders ──┐
  └─ React + Polaris web components                                          │
       │  fetch /api/* (App Bridge adds session token)                      ▼
       ▼                                                          Shopify webhooks
Express (single Node process) ───────────────────────────────────────────────┘
  ├─ /api/webhooks   HMAC-verified: orders/create, inventory_levels/update, app/uninstalled, GDPR
  ├─ /api/*          validateAuthenticatedSession → token exchange → shop-scoped JSON API
  │     routes/api.ts (thin, zod-validated) → services/* (business logic) → Drizzle → MySQL
  └─ /*              ensureInstalledOnShop → index.html (Vite dev middleware or built assets)
```

Key decisions:

- **Auth: token exchange + Shopify-managed installation.** `@shopify/shopify-app-express` with `future.tokenExchange` and expiring offline tokens. Scopes live in `shopify.app.toml`; App Bridge attaches a session token to every request and the backend exchanges it for an offline access token, stored in MySQL through `@shopify/shopify-app-session-storage-drizzle`. This is Shopify's current recommended OAuth flow for embedded apps: no redirect dance inside the iframe and no re-auth loops. The classic authorization-code paths are configured but unused.
- **One process, one port.** Express mounts Vite in middleware mode during development, so the CLI tunnel, HMR and the API share an origin (no CORS, no proxy config). In production the same server serves the built assets.
- **Polaris web components** instead of `@shopify/polaris` React, which is deprecated. React still handles state and routing; TanStack Query handles caching and invalidation after mutations.
- **Layers.** Routes only parse and validate (zod) and resolve the shop; services hold rules (scoring, plan state machine, sync); `insights.ts` holds read models for the dashboard. The risk engine has no I/O.
- **Tenancy.** Every query is filtered by `shop_id` taken from the verified session, never from the request body; foreign-key ownership (supplier/product IDs in a plan) is checked before writes.
- **Sync model.** A full sync pulls products/variants/stock and the last 60 days of orders over GraphQL; webhooks keep it fresh incrementally (orders add to `sales_daily`, inventory updates write a snapshot), each followed by a targeted rescore of just the affected products.
- **Webhooks are app-specific** (declared in TOML), acknowledged immediately, then processed.

## 4. Schema decisions (`app/web/src/server/db/schema.ts`, migration `app/web/drizzle/0000_init.sql`)

| Table | Why it exists |
|---|---|
| `session` | Shopify session storage; column types match what the Drizzle adapter expects. |
| `shops` | Tenant root. Planning defaults (lead time, safety stock, review period, overstock horizon) are **typed columns**, not a JSON blob, so they're validated and queryable. |
| `suppliers` | Lead time per supplier drives the risk model; unique (shop, name). |
| `products` | One row per **variant** (that's what runs out). Stock/price are a cache of Shopify; supplier, lead-time override, MOQ, cost and tracking flag are owned by the app. Unique (shop, variant GID). |
| `sales_daily` | Units + revenue per variant per day (composite PK). Pre-aggregated so scoring reads 30 small rows per product instead of raw orders; `is_simulated` keeps demo data distinguishable and real orders always win. |
| `inventory_snapshots` | Stock history with its source (sync / webhook / receipt). |
| `risk_scores` | **Append-only** score history with the factor breakdown as JSON. Latest row per product = current score. A row is written only when score, tier or recommendation changes (or at most daily), so webhooks don't flood it. |
| `alerts` | One open alert per (product, type); severity can escalate; resolved automatically when the condition clears. |
| `restock_plans` / `restock_plan_items` | Purchase orders with a status enum and timestamps per transition. Items keep `suggested_qty` next to `quantity`, so you can see how far the merchant deviated from the recommendation. |
| `activity_log` | Audit trail: actor (merchant / system / webhook), entity, action, summary and a JSON field-level diff. Written in the same transaction as the change it describes. |

All child tables cascade from `shops`, which makes uninstall clean-up and GDPR `shop/redact` a single delete. Dates for daily buckets are `DATE` columns read as strings to avoid timezone drift.

## 5. Tradeoffs

- **Simulated sales for the demo.** A fresh development store has no order history, so the risk engine would have nothing to score. The demo tools generate deterministic Poisson-distributed sales (weekend bumps, a recent spike on two products), clearly flagged and never mixed over real orders. Real orders flow in via sync and the `orders/create` webhook.
- **Extra write scopes** (`write_products`, `write_discounts`, `write_publications`, `write_online_store_navigation`) exist only so the dev seeder can build the demo store. In a production listing they would be removed; the app itself needs `read_products`, `read_inventory`, `read_orders`, `read_locations` and `write_inventory` (for receiving stock).
- **Protected customer data.** `orders/create` requires a protected-data declaration. The app only reads quantities and dates, stores no customer PII, and the sync degrades gracefully (catalog still syncs) if order access is denied.
- **Synchronous rescoring.** Rescoring runs inline after a webhook or edit. It is fine at demo size (65 variants) but would move to a queue for large catalogs.
- **Single-location assumption** for inventory webhooks (the payload is per location); the full sync sums all locations and reconciles.
- **60 days of order history** — the default `read_orders` window. Enough for 7/30-day velocity; not enough for seasonality.
- **Heuristic, not a forecast.** A transparent weighted score beats a black-box model for a merchant deciding whether to trust it, but it doesn't model seasonality, promotions or lead-time variance.
- **Theme fonts from Google Fonts.** Fraunces isn't in Shopify's font library; the `RemoteAsset` theme-check warning is disabled with a comment explaining why.
- **Client-side quiz scoring.** Fast and needs no app proxy, but the catalog JSON is limited to one collection (50 products) — fine for a roaster, not for a huge catalog.

## 6. What I'd improve with more time

- **Forecasting:** seasonality and trend from longer history (`read_all_orders`), per-weekday patterns, promotion awareness, lead-time variance from actual receipt dates (we already store ordered/received timestamps).
- **Multi-location** stock and transfers, with per-location recommendations.
- **Send POs to suppliers** (email/PDF from the plan, supplier portal link), partial receipts and backorders.
- **Background jobs** (BullMQ/queue) for syncs and rescoring, plus a nightly full reconcile; bulk operations API for large catalogs.
- **Notifications:** daily digest email / Slack when something turns critical.
- **Tests:** integration tests for services against a MySQL container, API contract tests, Playwright E2E for the embedded app and the theme quiz.
- **Theme:** subscription app integration for the Roast Club, quiz results saved to the customer account, an account icon in the header, product reviews, and Shopify Functions for a true bundle discount instead of a discount code.
- **Ops:** production deployment (Render/Fly + managed MySQL), structured logging, error tracking, rate-limit aware GraphQL client.
