# 4. Shop hours, closures and open-hours clocks

Status: accepted, 2026-10-01

## Context

Shops have staff who accept, pick and pack orders, and those staff keep hours. The design had no notion of hours:

- #20's flat 24h accept deadline auto-rejects and refunds an order placed at 8pm on a Friday to a shop that is closed all weekend, before anyone sees it.
- Delivery estimates ignore that a shop is closed.
- In-store pickup needs to tell the buyer when to come.

Facts that shaped the decision (checked 2026-10-01):

- Mercur 2.3.5 has date-range closures on the seller (`closed_from`, `closed_to`, `closure_note`), settable from the vendor and admin seller routes. `resolveVisibleSellerIds` (`@mercurjs/core/api/utils/sellers`) drops a closed seller from store routes, and our `src/lib/listings.ts` uses it, so a closed shop vanished from the buyer app without explanation, wishlist items included.
- Mercur has no weekly hours and only one closure range per seller, with no way to open on a normally closed day.
- No label is booked before staff accept and pack, so a closed shop can't send anything to the courier. The problems are buyer expectation and the clocks, not courier pickup.
- The app is in development with no live shops; data can be reseeded.

## Decision

### Model

Our own module owns a shop's hours:

- **Weekly hours**: per weekday, zero or more open periods.
- **Exceptions**: a date or date range, either closed (optional note) or open with special hours.
- **Pause**: closed from now, until resumed or until a set time.

Times are in the **region's timezone** (stored on the region; `Africa/Lagos` for NG). Weekly hours are **required** for every shop, an onboarding gate next to the pickup address and bank account (#26); there is no "no hours means always open" case. Seed shops get realistic hours.

The module is the **only source of truth**. Mercur's closure fields are unused and writes to them are refused on the vendor and admin seller routes, so two closure systems can't disagree. Our listing routes stop using `resolveVisibleSellerIds` for closures and return closed shops marked as such.

`@oja/domain` holds the pure functions: is a shop open at an instant, next opening, and **open time elapsed** between two instants.

### Ordering

- **Outside regular weekly hours**: orderable. The shop shows "Closed · opens 8am Mon"; checkout says the order is prepared when the shop opens; delivery estimates count from the next opening. Shipbubble is asked for rates with `pickup_date` on the day the shop opens, so its ETAs count from then; a rate quoted for today (the shop opens later today, or Shipbubble refuses a later pickup date) is moved later by the wait until the opening. No preparation time is added.
- **During an exception or a pause**: visible but not orderable. "Closed until Tue 14 Oct" plus the note; items can't be added to the cart and checkout refuses that shop's lines.

### Open-hours clocks

Deadlines measured from an order event count only time the shop is open:

- Accept deadline: 24 open hours (#20). Reminders on the same clock.
- Pickup hold: 5 open days; perishable orders until close of the next open day after Ready.

Closed hours and closed exceptions stop both clocks. A pause stops new orders, not the accept clock of orders already waiting when it starts: they are still accepted or auto-rejected at their original deadline, so a shop paused "until I resume" can't hold a buyer's money indefinitely (#18). The pickup hold does freeze during a pause. Accepted orders carry on when a shop pauses; the vendor app warns, before pausing, that waiting New orders must still be accepted or they'll be rejected at their deadline.

### Where it is managed

Weekly hours and planned exceptions in the web vendor panel; pause/resume in the vendor app. Owner/manager (`role_seller_administration`) only.

## Consequences

- No order is auto-rejected because a shop was closed when it was placed.
- Every clock and estimate depends on the hours module; a shop can't go live without hours.
- Mercur's own store routes (which we don't use from the apps) won't reflect our closures.
- Buyers see why a shop can't take orders instead of the shop disappearing.
- Holidays, emergencies and special openings are one exception list; a public-holiday calendar per region can be added later on top of it.
