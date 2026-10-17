# 11. Nearest shops, measured from the buyer's saved address

Status: accepted, 2026-10-17 (#43)

## Context

Listings (one product from one shop) on the feed, search, category and shop routes were ordered best name match, then the shop that ships soonest, then first listed. They were never ordered by price (docs/design.md "Listing order"). #3 asked for "relevance then nearest/fastest delivery". Ship time leaves out the courier's leg. For pickup (#12) distance is the whole trip.

Facts that shaped the decision (checked 2026-10-17):

- Every live shop has a pickup address with a confirmed pin (`metadata.latitude/longitude`). The onboarding gate needs the pin (ADR 0002, ADR 0007). Every saved buyer address has one too (#18).
- The pins are private. The vendor API never shows shop staff a buyer's pin (ADR 0002). A buyer must not learn a shop's exact pickup pin either. Distances to a shop from several addresses, accurate enough, would give it away (triangulation).
- A road-distance API (Google Distance Matrix) would cost one element per shop per listing request, and the ranking doesn't need that precision.

## Decision

- **Listing order:** name match, then **distance band**, then ship time, then exact distance, then first listed. Never by price. The bands are under 5 km, 5 to 15 km, and over 15 km (`DISTANCE_BANDS_KM` in `@oja/domain`). A shop nearby that ships in 3 days comes before one across town that ships tomorrow. Within a band, the shop that ships soonest comes first, and the nearer of two that ship as soon. A shop with no pin comes after those with one.
- **Measure:** the straight-line (haversine) distance between the buyer's saved address pin and the shop's pickup pin (`distanceKm`). No road-distance API.
- **API input:** `GET /store/listings`, `GET /store/listings/:seller_id/:product_id` and `GET /store/shops/:seller_id` take an optional `address_id`. The API looks it up among the signed-in customer's own addresses and measures from its pin. A guest's `address_id`, another customer's, or one without a pin is ignored: the request is answered in the usual order with no distance, not refused. The app never sends coordinates.
- **API output:** each listing's seller (and the shop page's header) carries `distance_km`, rounded: 0 under a kilometre, else the nearest whole kilometre (`roundedDistanceKm`). It is null without an address. No route returns a shop's coordinates. The app shows it as "under 1 km" or "3 km" (`distanceLabel`) on shop headers and beside the ship time on the product page.
- **Where from, in the app:** "Delivering to" at the top of Home and Search. It starts on the buyer's default saved address and can be switched to any saved address with a pin. The device remembers the choice until it is changed. If that address is deleted, it falls back to the default (`deliveringTo`). Checkout starts on the same address (`preselectedAddress`). A guest is asked to sign in ("Sign in to see shops near you"), and a buyer without a saved address to add one ("Add a delivery address"). There is no device-location prompt.

## Consequences

- Whole kilometres from saved addresses (each needs a Shipbubble-validated pin) are too coarse to put a shop's pin closer than about a kilometre. This holds unless a buyer saves many addresses around one shop on purpose. If that becomes a problem, the next step is coarser rounding, or measuring from the pin snapped to a grid.
- Without a saved address the order is what it was: name match, ship time, first listed.
- Listings are still worked out in memory before paging (fine at v1 catalogue sizes). Distance adds one address lookup per request and no extra query per shop: the seller query already loads the pickup address.
- A city with many shops in one band will lean on ship time. The bands are a starting point and live in `@oja/domain`, so they change in one place.
