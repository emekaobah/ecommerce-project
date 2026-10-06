# Oja — Design

Status: agreed 2026-09-26. Product name "Oja" (kept in a single config constant).

## Product

- Demo-grade (production-hardenable) **multi-vendor marketplace** on **Mercur.js v2.3.5** (Medusa 2.20.1).
- Launch market: Nigeria, NGN, English. Architecture is **multi-region ready** (see Multi-country).
- Seed: 3 Lagos vendors (grocery, fashion, electronics) in different areas; Paystack + Shipbubble test keys.

## Repo

Private GitHub monorepo (`emekaobah/ecommerce-project`) scaffolded by `create-mercur-app` (Bun). Pin Mercur/Medusa versions; verify a fresh scaffold boots.

- `apps/api` — Mercur backend (+ our custom modules)
- Mercur admin panel and vendor panel (web)
- Mercur Next.js storefront — kept as reference only
- `apps/mobile-buyer`, `apps/mobile-vendor` — Expo, Expo Router, dev builds
- `packages/*` — shared API client, types, design tokens/UI

Visual direction: **Monochrome** (option C on the design canvas, researched in Refero from Uber Eats' app): black and white, black full-width primary buttons with the price in the label, bold left-aligned headings, selected options outlined in black, products contained on light-grey tiles. Chosen for simplicity and because it is easy to build on later. Token roles: ink `#000000` for primary buttons and headings; **Oja blue `#0B5CFF`** only for the brand mark, active tab, links, selection outlines, quantity badges and progress (never a primary button fill); saffron `#FFC043` only for deals; tiles `#F3F3F3`, dividers `#E2E2E2`, secondary text `#545454`. Typeface Manrope. Status chips always pair a symbol and label with colour. Vendor app uses the same system at larger sizes with large touch targets and state chips.

## Buyer app

- Auth: **Clerk** (`@clerk/expo`) — native Google + Apple (required by App Store 4.8) + email. Clerk is the sole customer identity; Medusa customer emailpass disabled.
- Browse by category/seller, search. **Listings and product pages are shop-scoped** — a product is always shown as one shop's offer (price, delivery time, shop rating). **No cross-shop price comparison** (shops object; not in v1). The product page uses that space for summary, details, reviews and "more from this shop" suggestions.
- Multi-seller cart; checkout picks, **per seller**, either a Shipbubble rate (cheapest / fastest / best value, default best value) or **in-store pickup** where that shop offers it (see Pickup). A checkout where every shop is pickup asks for no delivery address, only the buyer's name and phone.
  - The Cart tab reads the cart grouped by shop (`GET /store/carts/:id/sellers`). The cart id is kept on the device, one for the guest and one per buyer; a guest cart with items carries over on sign-in (`@oja/domain` `cartOnSignIn`), and signing out leaves the buyer's cart with their account.
  - **Each line is pinned to its own offer's price** (#15). Medusa prices cart lines per variant and Mercur's cart pricing hooks put every offer in the cart into one context, so with two shops' offers of one variant in a cart, a quantity change, sign-in or address change repriced both at the cheaper shop's price. Our add and update-quantity routes price the line from its offer and store it as a custom price, which Medusa's refreshes keep. A shop's price change reaches a line when its quantity next changes, so **checkout must reprice every line from its offer before payment**.
  - Prices are VAT-inclusive through the **currency's** tax-inclusive preference: offer prices are per currency, and Medusa applies a region's preference only to region-scoped prices.
- Payment (#16, ADR 0003): checkout reprices every line from its offer, sets the address and each shop's delivery (Shipbubble, #23), and the backend initialises a Paystack transaction (our `paystack` payment provider; the `medusa-payment-paystack` plugin captured without a webhook). The app opens `authorization_url` in a WebView and catches Paystack's redirect to its deep link; the order is placed only when Paystack's signed `charge.success` webhook arrives, which captures the payment and splits the cart into one order per shop. A cancelled or failed payment places nothing; paying again starts a new transaction.
- Order history showing the parent order group → per-seller orders; live tracking.
  - The Orders tab (#17) reads `GET /store/order-history` (the buyer's order groups, newest first) and `GET /store/order-history/:id` (`src/lib/buyer-orders.ts`), not Mercur's `/store/order-groups`, which has no per-order state or refund. Each shop's order carries its `fulfilment` (as staff see it), `paid_total` (`total + credit_line_total`: a refund's credit line takes it off `total`) and `refund` (its `order_refund` rows summed; a failed one stops counting once made again). `@oja/domain` turns these into what the buyer reads: "Not accepted in time" for an order the deadline rejected, else the shop's reason; "Refund on its way", "Refunded" or "Refund delayed". A group of one order (#65) is shown as that order.
- Saved addresses, public reviews + ratings, product wishlist, promo codes.
- **Address entry** (ADR 0002): Google autocomplete or "use my current location" pre-fills the per-country form, then the buyer confirms a map pin; the pin's coordinates are validated with Shipbubble. Optional "Landmark / directions for the rider" field. Lookups go through the backend (`AddressLookupProvider`), signed-in only.

## Vendor app (fulfilment only)

- Auth: Mercur member (`/auth/member/emailpass`) + `x-seller-id`. Enable Medusa `rbac` flag.
  - Owner/manager → `role_seller_administration`; fulfilment staff → `role_seller_order_management`.
  - Staff invited by owner from the web vendor panel.
- Catalogue, onboarding, promotions and review replies remain in the **web vendor panel**.
- **Pick and pack** (#21): Start picking opens a checklist of the order's lines. Staff tick a line off by hand or scan barcodes with the camera: a scan ticks one more of the line whose variant carries that barcode, EAN or UPC (GTINs compared as 14 digits, so a UPC-A read as EAN-13 still matches); a barcode on no line warns (`scanBarcode`, `@oja/domain`). Each line's picked count is kept on the order's fulfilment row (`picks`), so progress survives leaving the screen and shows on any phone. Mark packed is refused until every line is picked in full; partial availability (#22) adds "unavailable" as the other way to resolve a line. Vendor API: `POST /vendor/orders/:id/start-picking`, `GET /vendor/orders/:id/pick-list`, `POST /vendor/orders/:id/pick-list/:item_id` (`{ picked }` sets a tapped line; `{ add }` counts a scan, so two phones scanning at once both count), `POST /vendor/orders/:id/pack`.
- Push notifications (Expo): new order, accept deadline approaching, courier pickup scheduled, pickup order not collected.
- **Pause / resume orders** (owner/manager only): closes the shop now, until reopened or until a set time (see Shop hours and closures).
- Pickup counter: scan the buyer's QR or type the 6-digit code, record who collected.

### Order state machine

Each seller order's **fulfilment method** (delivery or pickup) is fixed when the order is created. Both share the start; each then has its own typed path, so a pickup order can never book a label and a delivery order can never take a pickup code. The courier provider is one implementation of the delivery path (own riders would be another).

```
New → Accepted → Picking → Packed ─┬─ delivery: Label booked → Courier confirmed
                                   │      → Handed to courier → In transit → Delivered
                                   └─ pickup:   Ready for pickup → Collected
```

| State | Source |
|---|---|
| New … Packed | Ours (picking = line-item checklist, optional barcode scan) |
| Label booked | Shipbubble `shipment.label.created` / `pending` |
| Courier confirmed | Shipbubble `confirmed` |
| Handed to courier | Staff tap (who/when) **and** Shipbubble `picked_up`; flag if they disagree for hours |
| In transit | Shipbubble `in_transit` |
| Delivered | Shipbubble `completed` → payout eligible |

| Ready for pickup | Staff tap Packed on a pickup order (one tap); pickup code issued, buyer notified |
| Collected | Staff verify the pickup code → payout eligible |

Branches: **Rejected** (seller declines → refund); **Partially available** (order edit + partial refund); **Shipment cancelled** (Shipbubble `cancelled` → back to Packed, rebook); **Not collected** (pickup hold expires → refund, stock returned, see Pickup). Delivery is Shipbubble-only in v1.

### Shop hours and closures (ADR 0004)

- Every shop has **weekly opening hours** (per weekday, several periods or closed); an onboarding gate. Hours are in the shop's **region's timezone** (`Africa/Lagos` for NG).
- **Date exceptions** (one date or a range): closed (optional note) or special hours, which is also how a shop opens on a normally closed day. **Pause orders now** (vendor app) closes the shop at once, until reopened or a set time.
- Weekly hours and planned exceptions are managed in the web vendor panel; pause/resume in the vendor app. Owner/manager only.
- Our hours module is the **only source of truth**. Mercur's `closed_from` / `closed_to` / `closure_note` are unused and writes to them are refused.
- **Outside regular hours** the shop is orderable: it shows "Closed · opens 8am Mon", checkout says the order is prepared when the shop opens, and delivery estimates count from the next opening.
- **During an exception or pause** the shop is visible but not orderable: "Closed until Tue 14 Oct" with its note; items stay on the shop page and in wishlists but can't be added to the cart, and checkout refuses its cart lines.
- **Open-hours clocks**: the accept deadline (24h, #20) and the pickup hold count only time the shop is open. Pausing pauses the clock; existing accepted orders carry on, and the app warns about waiting New orders when pausing.

### Pickup

- A shop opts in by setting a **collection point**: by default it *follows* the shop's pickup address (ticking it consents to showing that address to buyers); unticked, it is a separate address entered as in ADR 0002. Always with buyer-facing instructions (and optional phone). It uses the shop's hours. Pickup is free.
- The **pickup code** is per seller order, random, issued at Ready for pickup and shown only in the buyer's order: 6 digits plus a QR of them. Server-verified, attempts rate-limited per order. Whoever holds the code may collect (bearer); staff see the buyer's name and items and record who collected.
- Collection is **all or nothing**, accepted only in Ready for pickup, allowed outside hours if staff are present. No switching method after payment.
- **Hold**: 5 days of open time after Ready; perishable orders until the shop closes on its next open day after Ready (mixed orders take the shorter). Reminders at half-way and on the last day. On expiry → **Not collected**: full refund, stock returned, no payout; but **perishable lines are not refunded** and are paid out to the shop (stated at checkout).

### Perishables

- Operator-set **perishable** flag on catalogue categories, inherited by products, operator-overridable per product; shops can't change it.
- A seller order with perishable lines is offered only Shipbubble rates whose `delivery_eta_time` is by end of the next day; if none, delivery is unavailable for that shop and pickup is offered where the shop has it.
- Food in v1 means groceries (packaged, fresh, chilled). Cooked food is out of scope.

## Backend additions (`apps/api`)

1. **Paystack payments** — our own provider (`src/modules/paystack`, ADR 0003). Captured only on webhook confirmation; vendors can't capture. Mercur 2.3.5 has no capture-on-fulfilment job to disable.
2. **Accept/reject module** — `POST /vendor/orders/:id/accept|reject`; scheduled job auto-rejects + refunds orders not accepted within **24 open hours** (ADR 0004; a flat 24h until shop hours land, #68, behind `acceptDeadline` in `@oja/domain`). Each order's state lives in `src/modules/order-fulfilment`; vendor order responses carry it as `fulfilment`. Rejecting cancels the order and refunds its share; a refund Paystack turns down is retried by the job.
3. **Paystack payout provider** (`IPayoutProvider`) — Paystack Transfers after delivery. Flat **10%** commission; platform absorbs Paystack fees. Payout amounts computed explicitly: seller promotions borne by seller, platform promotions borne by marketplace.
4. **Shipbubble fulfillment provider** — address validation, per-seller calculated rates, label on fulfilment, cancel, HMAC-SHA512-verified webhooks → state updates. Labels paid from the platform's Shipbubble wallet. Rates (#23, `src/lib/delivery.ts`): checkout validates the buyer's address (pin first) and keeps its `shipbubble_address_code`; each shop's pickup address is validated when it is saved (onboarding gates, #26), or when first quoted if it was saved before. Each shop has one calculated shipping option (`shipbubble_shipbubble`); checkout fetches the shop's rates (grams → kg, one parcel per shop) and stores the chosen rate, its choices and what they were quoted for on the shipping method's data, which is the method's price. A cart changed since is quoted again before payment. The store's own `POST /store/carts/:id/shipping-methods` is closed; `POST /store/carts/:id/checkout/delivery` picks another quoted choice. Best value is the cheapest rate arriving within a day of the fastest (`deliveryChoices`, `@oja/domain`). `SHIPBUBBLE_API_KEY` is required outside tests.
5. **Vendor onboarding gates** (ADR 0007) — Shipbubble-validated pickup address (Google autocomplete + map pin, ADR 0002) + Paystack-resolved bank account (transfer recipient) + weekly opening hours; offers hidden until all are complete. Web vendor panel extensions. Built (#26, `src/lib/onboarding.ts`): a shop is **live** when Mercur has it open and it has passed every gate. The pickup address passes once it carries a `shipbubble_address_code`, which only a validated save writes: the checklist's `POST /vendor/onboarding/pickup-address` checks the country's form (`@oja/domain`) and Mercur's own vendor and admin address routes are validated first too, so a refused address is never saved and the code always belongs to the address it sits on. The bank account passes once Paystack has resolved it and made a transfer recipient (`POST /vendor/onboarding/bank-account`, banks from `GET /vendor/onboarding/banks`), kept in `src/modules/shop-bank-account` rather than Mercur's payment details, which members can write unchecked. Our listing, shop, wishlist and cart routes read `liveSellerIds`; Mercur's `/store/offers`, `/store/sellers` and `/store/products` see only live shops' rows (`api/store/live-shops.ts`). Owners and managers enter the details; staff see the checklist (`GET /vendor/onboarding`). A buyer's own order groups and reviews still show a shop that has stopped being live. The vendor panel's Shop setup page lists what is missing, with the plain address form until #41 adds search and the pin, and a banner on Orders and Offers until the shop is live. The seed takes its shops through the same gates (placeholders only where Shipbubble or Paystack isn't configured, as in tests). Weekly hours join as the third gate with #68.
6. **Shipping attributes** — weight/dimensions/package category defaults per product category, vendor-overridable; weight required. Perishable flag per category, operator-only.
7. **Clerk auth provider** — custom Medusa auth provider verifying Clerk JWT, mapping to customer auth identity.
8. **Public review routes** — `GET /store/products/:id/reviews`, `GET /store/sellers/:id/reviews` (published only, avg rating + count; live shops only, via `liveSellerIds`, ADR 0007).
9. **Wishlist** (#32) — Mercur's `wishlist` block (products only), adapted: products are always one shop's offer, so each saved product keeps the shop it was saved from (a `seller_id` column on the wishlist–product link; saving it from another shop replaces it). `GET /store/wishlist` answers each as that shop's listing in the region (null once the shop stops selling it there), and `POST /store/wishlist/product/:id/cart` moves it into the buyer's own cart as that shop's offer, asking which variant when there are several. Signed-in only; the app sends a guest to sign in.
10. **Notifications** — Resend provider with React Email templates (order confirmation, delivery receipt); every email paired with an Expo push; push for all status changes.
11. **A shop sees only its own order** (#61, #62; `src/lib/shop-order.ts`, applied to every `/vendor/orders*` and `/vendor/payments*` response). A checkout split across shops has one Paystack payment, which Mercur's vendor order reads put on every order, and a line's variant carries every shop's price for it (offers share the variant's price set). Each order instead shows its share of the payment: captured and refunded from the order's own transactions, the other amounts scaled to that share, with Paystack's record of the whole charge and the payment sessions left out. A refund is likewise only the order's share, at most its own captures less its own refunds, and is recorded against the order (#20, `refundOrderShareWorkflow`): a `refund` order transaction whose `reference_id` is Medusa's refund, and an order refund with Paystack's refund id and status, which Paystack's `refund.*` webhooks update. A failed refund is taken off the order and refunded again. The web vendor panel's refund route goes through it too. A line's variant carries only the line's own price (its compare-at price when it was on sale, else what the buyer paid), because the web vendor panel strikes the variant's price through beside the line's: dropping the prices would strike through ₦0, and the shop's current offer price would strike through after any price change.

## Catalogue & product import

### What Mercur provides (v2.3.5)

- **Shared, operator-owned catalogue.** Products/variants hold content (title, description, images, weight, dimensions, barcode/EAN/UPC, attributes). Each seller's **offer** holds price, stock, seller SKU, lead time, backorder, shipping profile.
- Sellers can **propose** new products (`proposed` → admin confirm / reject / request changes). Later edits go through the `product-edit` change-request pipeline (low-risk edits auto-confirm).
- **Product attributes module**: global, category-linked typed attributes (`single_select`, `multi_select`, `unit`, `toggle`, `text`). `is_required` is only enforced client-side in Mercur; Oja's publish gate enforces required category attributes server-side (#33). Store filtering works only for variant-axis attributes.
- **Import:** admin CSV import UI existed in v2.0–v2.1 and was removed in v2.2.0 (2026-07-03, likely because the offer model moved prices off variants). Medusa's `/admin/products/import` API still exists. Vendor import exists only as the optional `product-import-export` registry block, which creates **draft products, not offers**, ignores the seller, and expects Medusa's full CSV format.
- No barcode lookup or enrichment.

### What we add

**A. Platform catalogue import + enrichment (admin).** Based on the removed v2.1 admin import page. Upload CSV → column mapping (saved per source) → preview with row errors → create via Mercur product workflows. Each created product is queued for **enrichment in the background** (worker), which fills its empty fields and then publishes it or sends it for review (see Rules). The import answers straight away; enrichment runs at each source's rate limit.

**B. Vendor offer import (vendor panel).** Adapt the `product-import-export` block. Vendor uploads any list (barcode, name, selling price, cost, stock…). Rows whose barcode matches a catalogue variant → **offers**. Unmatched rows → **seller-linked proposals** carrying whatever fields the vendor had; they land in the admin queue where A's enrichment runs before approval.

**C. Vendor app quick-add.** Scan barcode → if unmatched, take a photo + enter name/price → creates a proposal with a real image.

### Shop-scoped listings (no price comparison)

- Local shops object to side-by-side price comparison, so v1 never shows several shops' prices for the same product together.
- Search and category results are **grouped by shop**: a shop header (name, area, rating, delivery estimate) with a row of that shop's matching products and "See all". Shops come where their best result comes in the listing order below, so nearest / fastest first among equal matches — never by lowest price. The header's delivery estimate is the shop's usual ship time, the same wherever the shop appears; ratings join with reviews. A product may appear under two shops, but never side by side.
- The product page is always in a shop's context: that shop's price, delivery estimate and rating; then summary, details (attributes), reviews, "more from this shop" and "you might also like" (same shop).
- **Listing order** (every listing route: feed, search, category, shop): best name match first (whole name, then start of the name, then every search word starting a word of the name, then anywhere inside it), then the shop that ships soonest (its offers' slowest lead time, else the shop's default; unset last), then the order listings were first made. Never by price. "Nearest" joins once buyers have a delivery address to measure from. `GET /store/listings` takes `q` (every word must appear in the product name) and `category_id` (the category and those below it); Every listing's seller carries its area and usual ship time for shop headers; `GET /store/shops/:seller_id` adds the description for a shop page, again only for open shops serving the region (#14).
- Mercur's store API shows the cheapest offer on a product by default; we add shop-scoped store routes (`GET /store/listings`, `GET /store/listings/:seller_id/:product_id`: offer + product + seller, only for open shops serving the region) and don't use the cheapest-offer price in the buyer app. A listing's headline price is that shop's cheapest variant, shown as "From" when its variants differ (`@oja/domain`).
- Buyers can still add products from several shops to one cart; comparison is simply not surfaced.

### Rules

- **Field schema:** importers accept any subset of Medusa product/variant fields plus offer fields; mapping options are generated from the schema (including category attributes). GTIN/ISBN/ASIN map to EAN/UPC (Mercur doesn't store them). Barcodes are always read as text; prices like "₦1,500" parsed.
- **Minimum to create a row:** barcode or title + selling price. **Minimum to publish:** title, ≥1 image, category, weight, required category attributes — enforced **server-side**. Vendors/admin see a completeness score and missing-field list.
- **A selling price is required to list, not to publish** (#35). A master product's price comes from shops' offers, and buyers only ever see a product through an open shop's priced offer in their region, so an unpriced published product is invisible to buyers. Publishing no longer waits for a price because shops can only offer on *published* catalogue products in the vendor panel (Mercur's vendor product filter); a price rule at publish deadlocked every operator import.
- **Enrichment order** (per field, lower sources only fill empty fields, provenance recorded per field): supplied data → existing catalogue (by barcode) → configured product databases in priority order → AI draft (#36). The AI draft is the `ai_draft` source, last in `ENRICHMENT_SOURCES` (included by default when `ANTHROPIC_API_KEY` is set): Claude (`claude-opus-5-5`, structured output) sees the product's photos (fetched from where they were copied from, not our storage) and its data so far, and drafts only the fields still empty: title, description, weight or a catalogue category, never images. Each drafted field's provenance is flagged `drafted`, the admin's Enrichment page and the product page's Enrichment widget (where it is approved) mark it "AI draft", and the product always goes to review, even if a deployment lists `ai_draft` as trusted.
- **Sources are pluggable adapters, chosen by config** (`ENRICHMENT_SOURCES`: which run and in what order, the catalogue first by default; keys per adapter), so production can swap databases without code changes. Each adapter declares its licence as a **policy** that the worker enforces: *may show data publicly* (else its fields aren't used for listing content), *image rights* (else its images aren't copied), *attribution* (shown to buyers only when required), and a rate limit. Whether a source is **trusted** (drives approval) is the deployment's call, not the adapter's: `ENRICHMENT_TRUSTED_SOURCES`. **Open Food / Beauty / Products Facts** (ODbL / CC BY-SA, attribution required) is the demo adapter. Production is expected to use curated databases (e.g. Go-UPC) under negotiated terms; each adapter's policy must match its contract (Go-UPC's public ToS forbids making its data public and grants no image rights).
- **Approval is by who vouches for the data.** Operator imports are reviewed by the operator at preview, so they need no second review: once enriched they publish if complete. A product needs human review (Mercur's `proposed` queue) when a field came from an *untrusted* source, or when its submitter is untrusted (vendor proposals, #37) and no trusted source matched with an image and a category. AI drafts always need a human. Offers on existing products publish immediately. Admins can list what enrichment auto-published, and why, to spot-check it.
- **Images:** only stored in R2 (Medusa's file module) with source recorded; never hotlinked, including image URLs supplied in a sheet. Product photos are shown **contained on a neutral tile** (not full-bleed), so the pipeline removes backgrounds (on-device/server segmentation) and the approval queue includes a quick image check (accept cut-out, re-crop, or request a clean pack shot) — segmentation can keep hands holding a product. Quick-add asks staff to photograph products on a flat surface, not in hand.
- **Extra fields** (care instructions, voltage, fabric…) are Mercur category attributes, starting with a small set for grocery, fashion, electronics.
- **Units:** weight in grams, dimensions in cm; importer parses "1.5kg", "30cm"; Shipbubble provider converts to kg.
- **A shop's own discounts are shown; other shops' prices never are.** Shops fear losing buyers to a cheaper competitor, so no screen compares one shop's price with another's. A shop may still discount its own offer and show it: its normal price crossed out beside the sale price (`@oja/domain` `offerPrice`, #13). Sale prices come from sellers' price lists in the vendor panel and must be scoped to the seller's own offer, never the shared variant, or one shop's sale would change a competitor's price (#49). Cart-level promotions (codes, automatic deals) discount only that shop's items (#30).
- **Cost price** stored privately on the offer, visible to owner/manager role only; v1 use: below-cost warning. Kept in the `offer-import` module beside the offer (not in its metadata, which fulfilment staff can read), and served by `GET /vendor/offer-costs` behind the `offer:update` RBAC policy, which fulfilment staff lack (#37).
- **Stock** optional; if absent, treat as in stock / not tracked and rely on the pick-time out-of-stock path.

## Multi-country readiness (v1 ships NG only)

Target: independent per-country markets. Cross-border purchasing is out of scope and a separate future project.

1. Everything goes through Medusa regions; no hardcoded `NGN`; apps carry `region_id`, format money via `Intl`.
2. Sellers have a country + currency; offers visible only in regions they can serve.
3. Payment, fulfilment and payout providers selected per region / seller country (Paystack keys per country; Shipbubble serves NG region only; payout provider routes to the right Paystack account internally, since Mercur allows one payout provider).
4. Address forms driven by per-country config (NG: state + LGA); phone formats likewise. Address lookup goes through a per-region `AddressLookupProvider` (Google for NG), restricted to the region's countries server-side (ADR 0002).
5. Order states bound to a generic shipment-provider interface.

## Infrastructure

- **Railway** via `.railway/railway.ts` (Infrastructure as Code, ADR 0005): API service (`MEDUSA_WORKER_MODE=server`), worker service (`worker`), Railway Postgres 16, Railway Redis (default `noeviction` policy, which BullMQ needs), pre-deploy migrations, auto-deploy from `main`, EU West region. At least 2 GB RAM available per instance, per Mercur's self-host guide.
- **Cloudflare R2** for files (Medusa S3 file provider).
- **Domain**: `.com` via Cloudflare Registrar; subdomains `api.`, `vendor.`, `admin.`, `mail.`, Clerk's. Dev proceeds without it.
- **Sentry** (both apps + backend); **PostHog** (checkout funnel, vendor fulfilment timings).
- GitHub Actions (typecheck + tests); EAS Build (TestFlight + Android internal); EAS Update.

## Testing

- Integration tests (Medusa test utils, real Postgres) for everything touching money or shipping: payments, payouts, promo cost bearing, Shipbubble provider, accept/reject + auto-refund, webhook signatures.
- Unit tests for the order state machine.
- One Maestro E2E flow per app.

## Delivery plan

### Walking skeleton (first ticket)

- `create-mercur-app` scaffold with pinned versions; boot check.
- Docker Compose for Postgres + Redis, pinned to the host's versions.
- `apps/mobile-buyer` and `apps/mobile-vendor` from the default Expo Router template, in the monorepo.
- Shared typed API client + types package.
- Buyer app lists seeded catalogue products; vendor app logs a member in and lists the seller's orders.
- CI: typecheck + one test.
- Deployment config written and validated, not applied (originally `render.yaml`; now `.railway/railway.ts`).

### Design pass (in parallel with the skeleton)

One Claude Design canvas artifact, "Oja — App Design":
visual direction (tokens + core components, monochrome and vendor sizing), buyer screen map, vendor screen map, lo-fi flows (checkout, fulfilment, quick-add), and five hi-fi anchor screens (buyer home, product page, checkout; vendor order list, picking). Code (`packages/ui`) is the design system's source of truth.

### Vertical slices

Each slice is one user-visible capability end to end (backend + API + app screens + tests). Final split by `/to-tickets`; indicative order, money path first:

1. Buyer browses catalogue
2. Buyer signs in (Clerk)
3. Buyer pays with Paystack → vendor sees the order (flat shipping rate until slice 6)
4. Accept / reject + 24h auto-refund
5. Pick & pack (incl. partial availability)
6. Live Shipbubble rates at checkout
7. Label booking, handover & tracking (webhooks)
8. Vendor onboarding gates
9. Notifications (push + email)
10. Payouts (Paystack Transfers)
11. Reviews, wishlist, promotions
12. Catalogue import + enrichment (admin A, vendor B)
13. Vendor app quick-add (C)

Sentry/PostHog, seed data and demo polish ride along with the slices that need them.

### Ways of working

- Local development first; deploy to Railway once slice 3 works end to end. Webhooks tested locally via a tunnel.
- One branch + PR per ticket; merge only with green CI; `main` stays deployable.
- First slices worked interactively; later a mix of `ready-for-agent` / `ready-for-human` tickets.

## Out of scope (v1)

Returns (including a failed delivery of perishables and a buyer refusing items at a pickup counter), Shipbubble COD, own-rider delivery, cooked food, third-party or Oja-run pickup points, separate collection-point hours, cross-shop price comparison, vendor mode in buyer app, seller follows, phone OTP login, cross-border purchasing.

## Accounts needed

Paystack, Shipbubble, Clerk, Resend, Cloudflare (R2 + domain), Sentry, Expo/EAS, Apple Developer, Railway (`railway login`), GitHub.
