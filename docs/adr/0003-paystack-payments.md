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
  - `authorizePayment` verifies the transaction with Paystack. It is authorised only if Paystack reports `success` for exactly the amount and currency started. It never returns `captured`.
  - `getWebhookActionAndData` checks the HMAC-SHA512 signature (timing-safe) and maps `charge.success` to `SUCCESSFUL`, with the amount in naira.
  - `capturePayment` only records the capture, since Paystack settles a charge itself. `refundPayment` calls Paystack's refund API, noting Medusa's refund id as the `merchant_note`. A refunded transaction turns `reversed`, even partly, and still reads as paid.
- **Only the webhook places the order.** After Paystack redirects back, the app polls `GET /store/carts/:id/checkout` until `order_group_id` is set. The store's `POST /store/carts/:id/complete` answers `409` for a cart with a Paystack session, so no shop sees an order before the money is confirmed. The webhook isn't taken on trust either: completing the cart verifies the transaction with Paystack (`authorizePayment`), so a replayed or mistaken `charge.success` for an unpaid transaction places nothing.
- A **middleware** answers a Paystack webhook with a bad signature with `401` before Medusa queues it. The provider checks the signature again.
- **Vendors can't capture.** `POST /vendor/payments/:id/capture` returns `403`.
- **Paystack is the region's only payment provider** once `PAYSTACK_SECRET_KEY` is set (seed). The system provider is kept only when Paystack isn't configured, for local tries.
- Checkout routes (signed-in buyer, own cart only):
  - `POST /store/carts/:id/checkout` reprices every line from its offer, sets the email and address, and adds each shop's cheapest delivery option (the flat rate until #23).
  - `POST /store/carts/:id/checkout/payment` reprices the lines again, since the cart or a shop's price may have changed since the address was set. It then starts a new Paystack transaction each time, which is how a buyer retries after a failed or abandoned payment.
  - `GET /store/carts/:id/checkout` returns the checkout, whether it is `ready_to_pay`, and, once the cart is completed, its order group.

## Consequences

- Payment behaviour is tested at the HTTP seam against a fake Paystack API (`integration-tests/helpers/paystack.ts`). Webhooks are exercised locally through a tunnel (README).
- Locally, an order needs a working tunnel. Without it, the payment succeeds at Paystack and the app keeps waiting.
- A webhook's capture runs before the split. If the split then fails (for example, stock ran out between paying and the webhook), the money is captured with no order. The failure is logged; handling it (refund) belongs with #20's auto-refund.
- Paying twice is prevented, not refunded: starting a payment checks the cart's current transaction with Paystack and answers `409` once it is paid, and the app waits for the order. (The simulator run hit this: the buyer closed Paystack's page after paying and paid again.) A transaction paid after its session was already replaced, which the guard can't see, still needs #20's refunds.
- Mercur's default store order-group fields nest four relations deep, past Medusa's store limit of three, so clients request explicit `fields`.
