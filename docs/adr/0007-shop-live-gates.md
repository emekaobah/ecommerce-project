# 7. Shop live gates

Status: accepted, 2026-10-06 (#26)

## Context

A shop that Oja has approved can still be unable to trade. Couriers need a pickup address Shipbubble can place, and payouts (#29) need a bank account Paystack can pay. The design makes these onboarding gates: buyers see a shop's offers only once it has passed every gate. Weekly opening hours join as a third gate with ADR 0004 (#68).

Facts that shaped the decision (checked 2026-10-05):

- Mercur 2.3.5 decides which shops buyers may see with `resolveVisibleSellerIds` (`@mercurjs/core/api/utils/sellers`): approved, not suspended, not in a closure. It has no notion of onboarding.
- Mercur's store routes for offers, sellers and products (including each variant's cheapest offer) read through `req.scope`'s `query.graph` with their own filters. Copying their handlers to add a filter would fork them.
- A shop's pickup address is Mercur's seller address. Three routes save it: our checklist, Mercur's `POST /vendor/sellers/:id/address` and `POST /admin/sellers/:id/address`. The last two run `updateSellerAddressWorkflow`, which has an `addressUpdated` hook after the save step. Registration (`POST /vendor/sellers`) can also carry an address, but its body takes no `metadata`.
- Mercur's seller payment details are free-form fields saved as entered: nothing checks the account with the bank or registers a Paystack transfer recipient.
- Integration tests and local setups often run without Shipbubble or Paystack keys, but still need a seeded catalogue to show.

## Decision

### One definition of "live"

A shop is **live** when Mercur has it open (`resolveVisibleSellerIds`) **and** it has passed every gate in `ONBOARDING_STEPS`. That is one function, `liveSellerIds` in `src/lib/onboarding.ts`, with `isLive` for a single shop and `onboardingOf` for the vendor checklist. Adding a gate (hours, #68) means adding a step there. No route makes up its own rule.

Every store route that shows a shop or its offers reads it:

- Our listing, shop, wishlist and cart routes call it directly. Adding a non-live shop's offer to a cart is a 404.
- Mercur's `/store/offers*`, `/store/sellers*` and `/store/products*` get the `onlyLiveShops` middleware (`src/api/store/live-shops.ts`). It swaps the request's container (`req.scope`) for one whose `query` adds `seller_id IN live` (offers) or `id IN live` (sellers) to every `query.graph` call, as an extra `$and` so the route's own filters still hold. Mercur's handlers stay as they are, whatever order their middlewares run in.

Routes that show a buyer **their own** records are left alone: `/store/order-groups` and `/store/order-history` (a buyer's past orders keep their shop even if it later stops being live), and Mercur's `/store/reviews`. Despite its name, that route lists only the reviews the signed-in buyer wrote (`customer_id` from the session). A review also has no shop column, only a link table, so it can't be narrowed through the query wrapper. The public review routes (#7) read it: `GET /store/sellers/:id/reviews` is not found for a shop that isn't live (`isLive`). `GET /store/products/:id/reviews` rates the shared catalogue product whichever shop sold it, and shows no shop, so it isn't narrowed.

### Pickup address codes are only written once Shipbubble has validated the address

The pickup gate passes when the seller address carries the pin its owner confirmed on the map (`latitude`, `longitude`) and a `shipbubble_address_code` in its metadata. `validatedPickupChange` refuses an address without a pin, so no route saves one (#41); an address with a code but no pin, saved before pins were required, fails the gate. To make that code trustworthy, it is only ever written for the address Shipbubble just validated, and never taken from a request:

- `validatedPickupChange` (`src/lib/delivery.ts`) merges the change with the saved address, asks Shipbubble to place it, and returns the change with the code. If Shipbubble refuses, it fails with a 400 before anything is saved. It drops any code the request itself carries.
- Every save route runs it **before** writing. `POST /vendor/onboarding/pickup-address` first checks the country's form (`@oja/domain`, ADR 0002). Mercur's vendor and admin address routes get the `validatePickupAddressFirst` middleware (`src/api/pickup-address-check.ts`).
- An address saved without a code (e.g. at registration) fails the gate until it is saved through one of these routes. The one other writer is `senderAddressCode`, which validates a code-less address the first time a delivery is quoted from it and keeps the code. It also writes only after Shipbubble has placed that address, and a shop that isn't live can't be quoted, so it opens no way around the gate.

The first attempt validated in Mercur's `addressUpdated` hook instead. That hook runs after `updateSellerAddressStep` has saved the address, so a refused address depends on the step's compensation to undo it. Mercur's compensation for an updated address didn't restore the old one. A refused change stayed saved, still carrying the previous address's code, so the shop stayed live with an address Shipbubble never placed. Validating before the save avoids relying on compensation.

### Bank accounts live in our own module

The bank account and its Paystack transfer recipient live in `src/modules/shop-bank-account`, one row per shop: bank code and name, account number, the holder's name Paystack resolved, and `recipient_code`. They are not in Mercur's payment details or a `PayoutAccount`.

`POST /vendor/onboarding/bank-account` resolves the account with Paystack, creates the transfer recipient, and only then saves. If Paystack can't resolve the account, it is refused and the shop keeps its old one. Payouts (#29) read `recipient_code` from this module. Members never see the recipient code.

Owners and managers (seller update permission) enter the address and the bank account. Fulfilment staff see the checklist (`GET /vendor/onboarding`, seller read) but not the forms.

### Seed placeholders when a provider isn't configured

The seed takes its shops through the same gates. It validates the seeded pin with Shipbubble and resolves the seeded account with Paystack. When `SHIPBUBBLE_API_KEY` or Paystack isn't configured, it writes a placeholder instead: address code `0`, or recipient `RCP_seed_unverified`. That way the catalogue still shows in that environment, which can't deliver or pay anyway. A later seed run with the provider configured replaces the placeholder with a real code or recipient. A shop whose account Paystack refuses is left not live, with a warning.

## Consequences

- One rule decides what buyers see, and new gates join in one place. The cost is one extra lookup of seller addresses and bank accounts per store request.
- Mercur's store routes are narrowed without being forked. A new Mercur store route that reads offers or sellers must be added to the middleware list, or it will show shops that aren't live.
- The address code can be trusted. Any new route that saves a seller address must validate with `validatedPickupChange` first.
- A shop that stops being live disappears from browsing, but buyers' own orders and reviews still show it.
- Payouts depend on our bank-account module rather than Mercur's payout account model.
- A seeded environment without providers shows shops as live with placeholder codes. These must never reach production, where both providers are configured.
