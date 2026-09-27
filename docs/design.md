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
- Multi-seller cart; checkout picks a Shipbubble rate **per seller** (cheapest / fastest / best value, default best value).
- Payment: backend initialises Paystack transaction (`medusa-payment-paystack`); app opens `authorization_url` in a WebView; success only after backend confirms via webhook.
- Order history showing the parent order group → per-seller orders; live tracking.
- Saved addresses, public reviews + ratings, product wishlist, promo codes.
- **Address entry** (ADR 0002): Google autocomplete or "use my current location" pre-fills the per-country form, then the buyer confirms a map pin; the pin's coordinates are validated with Shipbubble. Optional "Landmark / directions for the rider" field. Lookups go through the backend (`AddressLookupProvider`), signed-in only.

## Vendor app (fulfilment only)

- Auth: Mercur member (`/auth/member/emailpass`) + `x-seller-id`. Enable Medusa `rbac` flag.
  - Owner/manager → `role_seller_administration`; fulfilment staff → `role_seller_order_management`.
  - Staff invited by owner from the web vendor panel.
- Catalogue, onboarding, promotions and review replies remain in the **web vendor panel**.
- Push notifications (Expo): new order, accept deadline approaching, courier pickup scheduled.

### Order state machine

```
New → Accepted → Picking → Packed → Label booked → Courier confirmed
    → Handed to courier → In transit → Delivered
```

| State | Source |
|---|---|
| New … Packed | Ours (picking = line-item checklist, optional barcode scan) |
| Label booked | Shipbubble `shipment.label.created` / `pending` |
| Courier confirmed | Shipbubble `confirmed` |
| Handed to courier | Staff tap (who/when) **and** Shipbubble `picked_up`; flag if they disagree for hours |
| In transit | Shipbubble `in_transit` |
| Delivered | Shipbubble `completed` → payout eligible |

Branches: **Rejected** (seller declines → refund); **Partially available** (order edit + partial refund); **Shipment cancelled** (Shipbubble `cancelled` → back to Packed, rebook). Delivery is Shipbubble-only in v1; states sit on a generic shipment-provider interface so own-riders can be added.

## Backend additions (`apps/api`)

1. **Paystack payments** — `medusa-payment-paystack`. Mark captured on webhook confirmation; disable Mercur's capture-on-fulfilment job.
2. **Accept/reject module** — `POST /vendor/orders/:id/accept|reject`; scheduled job auto-rejects + refunds orders not accepted within **24h**.
3. **Paystack payout provider** (`IPayoutProvider`) — Paystack Transfers after delivery. Flat **10%** commission; platform absorbs Paystack fees. Payout amounts computed explicitly: seller promotions borne by seller, platform promotions borne by marketplace.
4. **Shipbubble fulfillment provider** — address validation, per-seller calculated rates, label on fulfilment, cancel, HMAC-SHA512-verified webhooks → state updates. Labels paid from the platform's Shipbubble wallet.
5. **Vendor onboarding gates** — Shipbubble-validated pickup address (Google autocomplete + map pin, ADR 0002) + Paystack-resolved bank account (transfer recipient); offers hidden until both complete. Web vendor panel extensions.
6. **Shipping attributes** — weight/dimensions/package category defaults per product category, vendor-overridable; weight required.
7. **Clerk auth provider** — custom Medusa auth provider verifying Clerk JWT, mapping to customer auth identity.
8. **Public review routes** — `GET /store/products/:id/reviews`, `GET /store/sellers/:id/reviews` (published only, avg rating + count).
9. **Wishlist** — `bunx @mercurjs/cli add wishlist` (products only).
10. **Notifications** — Resend provider with React Email templates (order confirmation, delivery receipt); every email paired with an Expo push; push for all status changes.

## Catalogue & product import

### What Mercur provides (v2.3.5)

- **Shared, operator-owned catalogue.** Products/variants hold content (title, description, images, weight, dimensions, barcode/EAN/UPC, attributes). Each seller's **offer** holds price, stock, seller SKU, lead time, backorder, shipping profile.
- Sellers can **propose** new products (`proposed` → admin confirm / reject / request changes). Later edits go through the `product-edit` change-request pipeline (low-risk edits auto-confirm).
- **Product attributes module**: global, category-linked typed attributes (`single_select`, `multi_select`, `unit`, `toggle`, `text`). `is_required` is only enforced client-side in Mercur; Oja's publish gate enforces required category attributes server-side (#33). Store filtering works only for variant-axis attributes.
- **Import:** admin CSV import UI existed in v2.0–v2.1 and was removed in v2.2.0 (2026-07-03, likely because the offer model moved prices off variants). Medusa's `/admin/products/import` API still exists. Vendor import exists only as the optional `product-import-export` registry block, which creates **draft products, not offers**, ignores the seller, and expects Medusa's full CSV format.
- No barcode lookup or enrichment.

### What we add

**A. Platform catalogue import + enrichment (admin).** Based on the removed v2.1 admin import page. Upload CSV → column mapping (saved per source) → preview with row errors → create via Mercur product workflows. Enrichment fills empty fields per row.

**B. Vendor offer import (vendor panel).** Adapt the `product-import-export` block. Vendor uploads any list (barcode, name, selling price, cost, stock…). Rows whose barcode matches a catalogue variant → **offers**. Unmatched rows → **seller-linked proposals** carrying whatever fields the vendor had; they land in the admin queue where A's enrichment runs before approval.

**C. Vendor app quick-add.** Scan barcode → if unmatched, take a photo + enter name/price → creates a proposal with a real image.

### Shop-scoped listings (no price comparison)

- Local shops object to side-by-side price comparison, so v1 never shows several shops' prices for the same product together.
- Search and category results are **grouped by shop**: a shop header (name, area, rating, delivery estimate) with a row of that shop's matching products and "See all", shops ordered nearest / fastest first — never by lowest price. A product may appear under two shops, but never side by side.
- The product page is always in a shop's context: that shop's price, delivery estimate and rating; then summary, details (attributes), reviews, "more from this shop" and "you might also like" (same shop).
- Mercur's store API shows the cheapest offer on a product by default; we add shop-scoped store routes (`GET /store/listings`, `GET /store/listings/:seller_id/:product_id`: offer + product + seller, only for open shops serving the region) and don't use the cheapest-offer price in the buyer app. A listing's headline price is that shop's cheapest variant, shown as "From" when its variants differ (`@oja/domain`).
- Buyers can still add products from several shops to one cart; comparison is simply not surfaced.

### Rules

- **Field schema:** importers accept any subset of Medusa product/variant fields plus offer fields; mapping options are generated from the schema (including category attributes). GTIN/ISBN/ASIN map to EAN/UPC (Mercur doesn't store them). Barcodes are always read as text; prices like "₦1,500" parsed.
- **Minimum to create a row:** barcode or title + selling price. **Minimum to publish:** title, selling price, ≥1 image, category, weight, required category attributes — enforced **server-side**. Vendors/admin see a completeness score and missing-field list.
- **Enrichment order** (per field, lower sources only fill empty fields, provenance recorded): supplied data → existing catalogue → Open Food Facts / Open Beauty Facts / Open Products Facts (ODbL / CC-BY-SA, attribution shown) → AI draft (Claude vision; flagged for review). Sources are pluggable. **Go-UPC not in v1** (ToS forbids making data public and grants no image rights); slot kept, written permission worth pursuing if rich fields matter.
- **Approval:** offers on existing products publish immediately. New products need admin approval; OFF matches with image + category may auto-approve; AI drafts always need a human.
- **Images:** only stored in R2 with source recorded; never hotlinked. Product photos are shown **contained on a neutral tile** (not full-bleed), so the pipeline removes backgrounds (on-device/server segmentation) and the approval queue includes a quick image check (accept cut-out, re-crop, or request a clean pack shot) — segmentation can keep hands holding a product. Quick-add asks staff to photograph products on a flat surface, not in hand.
- **Extra fields** (care instructions, voltage, fabric…) are Mercur category attributes, starting with a small set for grocery, fashion, electronics.
- **Units:** weight in grams, dimensions in cm; importer parses "1.5kg", "30cm"; Shipbubble provider converts to kg.
- **No compare-at ("was") price in v1**: crossed-out prices don't suit the local market yet. If it returns, store it on the offer, not on variant price lists (which are variant-scoped, not per seller). The buyer app's strike-through (#13) is a display rule only: it shows an offer's original price when its calculated price is lower, which nothing in v1 produces. Turning sales on is still an open decision; a variant-level price list would lower every shop's price for that variant, so any sale must be scoped to the offer.
- **Cost price** stored privately on the offer, visible to owner/manager role only; v1 use: below-cost warning.
- **Stock** optional; if absent, treat as in stock / not tracked and rely on the pick-time out-of-stock path.

## Multi-country readiness (v1 ships NG only)

Target: independent per-country markets. Cross-border purchasing is out of scope and a separate future project.

1. Everything goes through Medusa regions; no hardcoded `NGN`; apps carry `region_id`, format money via `Intl`.
2. Sellers have a country + currency; offers visible only in regions they can serve.
3. Payment, fulfilment and payout providers selected per region / seller country (Paystack keys per country; Shipbubble serves NG region only; payout provider routes to the right Paystack account internally, since Mercur allows one payout provider).
4. Address forms driven by per-country config (NG: state + LGA); phone formats likewise. Address lookup goes through a per-region `AddressLookupProvider` (Google for NG), restricted to the region's countries server-side (ADR 0002).
5. Order states bound to a generic shipment-provider interface.

## Infrastructure

- **Render** via `render.yaml` Blueprint: web service (`MEDUSA_WORKER_MODE=server`), background worker (`worker`), Render Postgres, Key Value with `maxmemoryPolicy: noeviction`, `preDeployCommand` migrations, auto-deploy from `main`.
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
- Docker Compose for Postgres + Redis, pinned to Render's versions.
- `apps/mobile-buyer` and `apps/mobile-vendor` from the default Expo Router template, in the monorepo.
- Shared typed API client + types package.
- Buyer app lists seeded catalogue products; vendor app logs a member in and lists the seller's orders.
- CI: typecheck + one test.
- `render.yaml` written and validated, not applied.

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

- Local development first; deploy to Render once slice 3 works end to end. Webhooks tested locally via a tunnel.
- One branch + PR per ticket; merge only with green CI; `main` stays deployable.
- First slices worked interactively; later a mix of `ready-for-agent` / `ready-for-human` tickets.

## Out of scope (v1)

Returns, Shipbubble COD, own-rider delivery, cross-shop price comparison, vendor mode in buyer app, seller follows, phone OTP login, cross-border purchasing.

## Accounts needed

Paystack, Shipbubble, Clerk, Resend, Cloudflare (R2 + domain), Sentry, Expo/EAS, Apple Developer, Render (`render login`), GitHub.
