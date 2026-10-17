# 3. Paystack payments

Status: accepted, 2026-09-28 (#16)

## Context

Buyers pay for a multi-shop cart once, with Paystack. The design (`docs/design.md`) asks that a payment count as captured only when Paystack's webhook confirms it, and that Mercur's capture-on-fulfilment job be disabled.

What we found (checked 2026-09-28):

- `medusa-payment-paystack` 2.1.1, the plugin the design names, doesn't match that:
  - `authorizePayment` verifies the transaction and returns `captured`, so a cart completed from the app captures without any webhook.
  - Its webhook maps `charge.success` to `authorized`, with the amount in kobo where Medusa expects naira.
  - It can't pass a per-transaction `callback_url`, which the app needs to catch the return in its WebView.
  - Its API URL is hard-coded, so tests can't point it at a fake.
- Mercur 2.3.5 replaces Medusa's payment webhook handling. `/hooks/payment/:provider` emits `mercur.payment.webhook_received`, and Mercur's `processPaymentWorkflow` handles it. For `SUCCESSFUL` it authorises and captures the session, then completes the cart with `completeCartWithSplitOrdersWorkflow`: one order group, one order per shop.
- Mercur 2.3.5 ships **no scheduled jobs**. The capture-on-fulfilment and payout jobs in its payout docs don't exist in this version, so there is nothing to disable.
- A region seeded with `pp_system_default` lets any buyer complete a cart without paying.

## Decision

- **Our own provider**, `src/modules/paystack` (id `pp_paystack_paystack`), in place of the plugin. It's about 150 lines over Paystack's Transactions API:
  - `initiatePayment` starts a transaction for the cart total in kobo. It sends the return URL as `callback_url` and as `metadata.cancel_action`, and the session id in `metadata`. Paystack only redirects to an http(s) URL and silently drops a deep link like `oja://…` (found testing on the simulator), so the return URL is `GET /paystack/return` on the API. The app's WebView catches it and never loads it; the page only tells a browser to go back to the app.
  - `authorizePayment` verifies the transaction with Paystack. It is authorised only if Paystack reports `success` for exactly the amount and currency started. It never returns `captured`. A successful charge for another amount or currency is never authorised, so no payment records it: its `charge.success` is refunded in full on Paystack directly, like a replaced page's, and logged as an error (a bug or tampering, #38).
  - `getWebhookActionAndData` checks the HMAC-SHA512 signature (timing-safe) and maps `charge.success` to `SUCCESSFUL`, with the amount in naira.
  - `capturePayment` only records the capture, since Paystack settles a charge itself. `refundPayment` calls Paystack's refund API, noting Medusa's refund id as the `merchant_note`. A refunded transaction turns `reversal-pending`, then `reversed`, even partly (checked in test mode), and still reads as paid. Paystack refuses a refund under ₦50.
- **Only the webhook places the order.** After Paystack redirects back, the app polls `GET /store/carts/:id/checkout` until `order_group_id` is set. The store's `POST /store/carts/:id/complete` answers `409` for a cart with a Paystack session, so no shop sees an order before the money is confirmed. The webhook isn't taken on trust either: completing the cart verifies the transaction with Paystack (`authorizePayment`), so a replayed or mistaken `charge.success` for an unpaid transaction places nothing.
- A **middleware** answers a Paystack webhook with a bad signature with `401` before Medusa queues it. The provider checks the signature again.
- **Vendors can't capture.** `POST /vendor/payments/:id/capture` returns `403`.
- **Paystack is the region's only payment provider** once `PAYSTACK_SECRET_KEY` is set (seed). The system provider is kept only when Paystack isn't configured, for local tries.
- Checkout routes (signed-in buyer, own cart only):
  - `POST /store/carts/:id/checkout` reprices every line from its offer (unit price, compare-at price and tax inclusivity, reporting the changed lines as `price_changes`), sets the email and address, and adds each shop's cheapest delivery option (the flat rate until #23).
  - `POST /store/carts/:id/checkout/payment` reprices the lines again, since the cart or a shop's price may have changed since the address was set. When a price changed it starts nothing: it answers `payment: null` with `price_changes` (each line's price before and after) and the repriced checkout, so the buyer sees what changed before paying, and pays the new total by calling again (#57). Otherwise it starts a new Paystack transaction each time, which is how a buyer retries after a failed or abandoned payment. A line whose offer is gone blocks payment until it is removed, and a shop's delivery is dropped once the cart holds nothing from it.
  - `GET /store/carts/:id/checkout` returns the checkout, whether it is `ready_to_pay`, and, once the cart is completed, its order group.

## Consequences

- Payment behaviour is tested at the HTTP seam against a fake Paystack API (`integration-tests/helpers/paystack.ts`). Webhooks are exercised locally through a tunnel (README).
- Locally, an order needs a working tunnel. Without it, the payment succeeds at Paystack and the app keeps waiting.
- A webhook's capture runs before the split, and Mercur runs the split with `continueOnPermanentFailure`, so a split that fails (a promo code's last use taken by another cart, stock run out, an offer or delivery option gone, a timeout) leaves the money captured with no order, and nothing retries it. A paid cart that fails to become orders is refunded in full, never placed in part (#38):
  - Our webhook subscriber, for a `charge.success` paid in full for a live session, waits for Mercur's capture, then a few seconds more for its split to have run (it runs as a step of Mercur's webhook workflow, which skips the cart's lock, so there is no lock to wait on). If the cart isn't orders, the split is tried once more, under the cart's lock, with no telling transient failures from permanent ones. If that fails too, the payment is refunded in full under the `payment-refund:<payment>` lock every refund of it takes.
  - The refunded cart is fixed the way a price change is shown: its payment sessions are deleted (so Paystack sending the webhook again places nothing on the refunded payment), lines whose offer is gone removed, sold-out lines cut to what is left, deliveries whose option is gone taken off, and used-up codes dropped. Why, the amount refunded and what changed are kept on the cart, and `GET /store/carts/:id/checkout` returns them as `not_placed: { reason, amount, changes }`, `reason` one of `code_used_up`, `sold_out`, `unavailable`, `delivery` or `other` (the first that fixing the cart found, in that order). The buyer app's confirmation screen stops waiting and goes back to checkout, which says why and what changed; the buyer pays the new total, and starting that payment clears `not_placed`.
  - The buyer is pushed and emailed the reason and the amount; the email says a refund can take a few days to reach the card.
  - The accept-deadline job (#20) stays as the backstop: it refunds in full, through the same path and lock, a payment no order's `capture` transaction claims once it is 30 minutes old (say, Paystack turned the first refund down). A payment already refunded has nothing left to refund.
  - A shop paused or closed while the buyer pays still gets the order; it can reject it within its accept window, which refunds. Code uses aren't reserved before payment: a cart that loses the last use is refunded instead.
- Paying twice is prevented, not refunded: starting a payment checks the cart's current transaction with Paystack and answers `409` once it is paid, and the app waits for the order. (The simulator run hit this: the buyer closed Paystack's page after paying and paid again.) A transaction paid after its session was already replaced, which the guard can't see, never becomes a Medusa payment (Mercur's handler finds no session). Its `charge.success` webhook is refunded in full on Paystack directly instead (#20), and recorded as an order refund with no order.
- Moving a shop's items to a shop cart (#11) deletes the original cart's payment sessions first. A Paystack page opened for the whole cart then has no session, so paying on it places no order and is refunded in full, like a replaced page. Once the cart's current transaction is paid, moving is refused (`409`): its order is on the way. Going back moves the items back and deletes the shop cart's sessions the same way, so its page is refunded if paid, and is refused once the shop cart is paid.
- Each move is one workflow holding the cart lock Mercur's completion takes (the cart's id; going back locks both carts). A `charge.success` that lands mid-move completes the cart before the move, which then finds it paid or checked out and refuses, or after it, when its session is gone. A move that fails part-way is undone step by step. A step undone after the cart's session was deleted recreates it as a new session, so a page opened before the move is then refunded if paid, and the buyer pays again.
- Mercur's default store order-group fields nest four relations deep, past Medusa's store limit of three, so clients request explicit `fields`.
