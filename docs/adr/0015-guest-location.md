# 15. Guests browse nearest shops from their phone's location, snapped to a grid

Status: accepted, 2026-10-25. Amends ADR 0011: the app may now send coordinates.

## Context

ADR 0011 measures distance only from a signed-in buyer's saved address, and "the app never sends coordinates". A guest, or a buyer who hasn't saved an address yet, sees shops in name, ship time and first-listed order, with no distance. Production marketplaces (Uber Eats, Glovo, Deliveroo, Instacart) let a guest browse from their location and ask for sign-in only at checkout.

The rule protected a shop's pickup address. It is where the courier collects, and it can be the seller's home. The vendor panel promises it isn't shown to buyers unless the shop consents, by letting its collection point follow it (docs/design.md, Pickup). Buyers already see each shop's area and a rounded distance (ADR 0011).

The rule never fully kept that promise. A signed-in user can save many validated addresses and read rounded distances from each (ADR 0011's own consequence). With free coordinates and whole-kilometre rounding, finding where a shop's distance flips from 2 km to 3 km puts the searcher on a circle around it, and a few circles fix it.

## Decision

- **Input:** the listing routes that take `address_id` (`GET /store/listings`, `GET /store/listings/:seller_id/:product_id`, `GET /store/shops`, `GET /store/shops/:seller_id`) also take an optional `near` (`lat,lng`). It is used only when no usable `address_id` is sent: for a guest, a buyer without saved addresses, or one whose `address_id` isn't theirs. A saved address still wins.
- **Snapping:** the server rounds `near` to 2 decimal places (a grid of about 1.1 km) before measuring, in `deliveringToOf`. It never trusts the app to snap. Out-of-range or malformed values are ignored (the request is answered as with no location), not refused, as ADR 0011 does for a bad `address_id`.
- **Output:** unchanged. `distance_km` is rounded as before, the bands are the same, and no route returns a shop's coordinates or pickup address.
- **Not covered:** the delivery estimate (`…/delivery-estimate`) and checkout still need a saved, Shipbubble-validated address. A guest's product page shows the shop's dispatch time, as today. Checkout still requires sign-in.
- **App:** a guest who taps "Use my current location" keeps that pin on the device as their *guest spot* and sends it as `near`. The band names it from the phone's own geocoder (`expo-location`'s `reverseGeocodeAsync`, no backend lookup), else "Your current location". It is separate from the "Delivering to" saved address, which checkout reads. Once the buyer has a saved address, it is used and the spot is cleared. When a buyer adds their first address, the address entry starts at the spot.
- **Guests use GPS only.** Typing an area would need the Google lookup routes, which ADR 0002 keeps signed-in only. A guest who declines location is offered sign-in to search an address.

## Consequences

- Guests and buyers without an address see nearest shops first, in line with production marketplaces.
- The promise to home sellers holds at least as well as before. Every point in a grid cell measures from the same centre, so a searcher can't walk a boundary. Many cells together narrow a shop to about a neighbourhood, which its area name already says. If that ever needs tightening, the next step is to give `near` requests distance bands only, with no `distance_km`.
- Listing requests now vary by `near` as well as `address_id`, so the app's query keys must include it.
- The location permission's purpose string covers browsing as well as address entry.
