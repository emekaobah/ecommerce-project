# 9. Paying shops with Paystack Transfers

Status: accepted, 2026-10-09 (#29)

## Context

Shops are paid after delivery, less a flat 10% commission, by Paystack Transfer. Oja absorbs Paystack's fees. A shop's order in a split checkout is one share of one Paystack payment (#20), and it can be refunded in part: when items are unavailable (#22), by staff, or by hand in Paystack's dashboard. Paystack takes refunds out of the same balance payouts are paid from.

Facts that shaped the decision (checked 2026-10-09):

- Mercur 2.3.5's payout module takes exactly one provider (`IPayoutProvider`). With none configured it registers a system provider that marks every payout paid without paying anyone.
- Mercur's `createPayoutWorkflow` pays `order.total` less the order's commission lines. That total includes the delivery fee, and a refund doesn't change it, so it would pay a shop for refunded goods. The workflow doesn't link the payout to its order, and it passes the order id to the provider as an idempotency key, but nothing stops a second payout for the same order.
- Mercur's `payout` table only accepts `pending`, `paid`, `failed` and `canceled` as statuses. Its `PayoutStatus` enum also has `processing`, and an insert with that status is refused.
- Mercur's module creates a payout only after the provider has made the transfer. So a transfer's reference can't be the payout's id.
- A Paystack account sends every webhook to one URL. We already point it at the payment webhook (`/hooks/payment/paystack_paystack`), so `transfer.*` events arrive there and never at Mercur's `/hooks/payout`.
- Courier labels are paid from Oja's Shipbubble wallet (#24), so the delivery fee the buyer paid is Oja's money.
- An order edit (#22) lowers `order.total`. It doesn't change what was captured for the order, only what is refunded.

## Decision

- **Our own payout provider** (`src/modules/paystack-payout`), registered on Mercur's payout module when `PAYSTACK_SECRET_KEY` is set. It has one Paystack account per currency (`accounts.ngn` for now), which is how a seller in another country will be paid. Onboarding is Oja's Shop setup page (#26), so a payout account is active from the start and holds nothing. Each payout names its recipient, read from the shop's bank account when the payout is made. It is never read from the payout account, which members can create through Mercur's route. A queued transfer is `pending`, `success` is `paid`, and `failed`, `reversed` (and Paystack's other end states) are `failed`. A payout of nothing sends no transfer and is `paid`.
- **Our own payout workflow** (`payOutOrderWorkflow`) in place of Mercur's. The amount is worked out explicitly (`payoutOf`): what was captured for the order, less its refunds, less the delivery fee, less 10% of what is left. The calculation runs in kobo. The order's refund lock is held while it runs, so a refund and a payout of the same order never interleave.
- **One `shop_payout` row per attempt at an order** (in the order-fulfilment module), written before Paystack is asked to transfer. `order_id` with `attempt`, and `transfer_reference`, are unique, and an order with a live or paid attempt isn't tried again, so an order is paid once and Paystack won't make the same transfer twice. The row keeps how the payout was worked out. The transfer and its status stay in Mercur's payout, linked to the order and the seller. If Paystack refuses the transfer, the row is removed and the order is tried again on the next run. A transfer that fails later (`transfer.failed` or `reversed`) keeps its row and is retried on the next run as a new attempt (`attempt`, reference `payout_<order id>_<n>`), up to three attempts. After the third failure the admin is notified to pay the shop by hand (`nextPayoutAttempt`). If Paystack took the transfer and something after it failed, the row is kept and the error is logged.
- **The daily `pay-out-delivered-orders` job** (01:00 UTC) pays each order whose `payout_eligible_at` is set. Delivered sets it (#25), and Collected will too (#70). It skips orders already paid out and orders with a refund that is still `pending`, `processing` or `needs-attention`. A shop's orders are paid one at a time, oldest first.
- **A refund after a payout is taken from the shop's next payouts.** What a shop owes back is what its paid-out orders were paid beyond what they are owed now, less what later payouts already took back (`owedBack`). Only orders that have had a refund are worked out again, and payouts that failed count for nothing. A delivered order cancelled since is never paid. If a refund that was taken back later fails, the shop owes less than nothing, and the next payout gives the difference back.
- **`transfer.*` webhooks** are handled with the payment webhooks (`src/subscribers/paystack-webhook.ts`). The signature is checked by the route, and the transfer's status is fetched from Paystack before Mercur's `processPayoutForWebhookWorkflow` sets the payout paid or failed.
- **The daily `check-paystack-refunds` job** (00:30 UTC, before the payouts) lists the previous UTC day's Paystack refunds (`GET /refund`). Any refund whose id no `order_refund` row records is logged and posted to the admin's notifications.
- **Commission shown in the vendor panel**: the seed sets Mercur's global commission rate to 10%, tax included, delivery left out. Mercur's commission line on each order then matches the commission in our payout.

## Consequences

- The vendor panel's Payouts page (Mercur's) lists a shop's payouts. Each order page shows its payout through our `GET /vendor/orders/:id/payout`: what the buyer paid, delivery, refunds, commission, the payout, anything taken back, and where it is. Like `/vendor/payouts`, it needs `payout:read`.
- Mercur's commission lines don't follow refunds made without an order edit, but payouts don't read them. After such a refund, the order page shows Mercur's commission as the order was placed beside the payout's, which is what the shop is charged.
- A refund records what it covers: items or delivery (#22). Shops refund only items, so the vendor refund route always records items, and a refund of items is taken off what the shop is paid for goods. Only Oja's staff refund delivery (`POST /admin/orders/:id/delivery-refund`), at most the delivery fee less what was refunded of it already. Oja keeps the delivery fee, so it bears a refund of it: `payoutOf` takes it off Oja's delivery share, never off the shop's payout, and the payout doesn't wait for it to settle.
- Paying one transfer per order costs a Paystack transfer fee per order.
- A discount lowers what was captured, so the shop bears it, unless Oja funds it: ADR 0010 (#6) adds those back.
