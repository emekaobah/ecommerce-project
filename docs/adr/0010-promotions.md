# 10. Promotions worked out shop by shop, and who pays for them

Status: accepted, 2026-10-14 (#6)

## Context

Buyers enter promo codes at checkout. Shops create their own promotions in the web vendor panel, and the operator creates marketplace-wide ones in the admin panel. A shop's promotion must only ever discount its own items (docs/design.md: no cross-shop comparison). Who pays for a discount decides the shop's payout (ADR 0009): today a shop's payout is what the buyer paid for its order, so every discount lowers it, even one Oja runs.

Facts that shaped the decision (checked 2026-10-14, Mercur 2.3.5 on Medusa 2.20.1):

- Mercur links a vendor's promotion to its seller. Its `POST /store/carts/:id/promotions` works the cart's promotions out over **every** item, then drops a shop's discounts from other shops' items. A shop's fixed amount spread across the cart (`across`) is cut down to its items' share.
- Medusa works a cart's promotions out again on every change to the cart (`refreshCartItemsWorkflow` → `updateCartPromotionsWorkflow`). That path doesn't know about shops: after any line change or delivery change, a shop's code and every shop's automatic promotion discount every shop's items. The workflow has no hook after it runs, and Mercur already uses the one refresh hook (Medusa allows one handler per hook).
- Medusa's code check only says a code is "invalid" when it doesn't exist. An expired, used-up or non-applying code is silently dropped.
- Mercur's admin asks who covers an operator promotion's cost (`promotion_cost`: the shop, the marketplace, or shared by a percentage). It stores the answer, but nothing reads it, and an order doesn't keep it.
- An order edit (#22) lowers a line's quantity but leaves its adjustments as they were placed (Medusa only works them out again with `carry_over_promotions`). Adjustment amounts leave VAT out unless the promotion includes it, and prices here include VAT.

## Decision

- **Promotions are worked out shop by shop** (`applyShopPromotionsWorkflow`, `shopAdjustments`). Each shop's promotions are worked out on its own items alone, and the operator's on the whole cart. The cart's adjustments are then replaced. A shop's `across` amount is spread over its own items only. Stacked promotions never take an item below nothing. Only the operator's promotions discount delivery: Oja charges for delivery and pays the courier. The vendor routes refuse a shop promotion that targets delivery.
- **Checkout runs it after every change it makes**, and after each change from the cart routes the app uses (add, update and remove line, merge carts). It runs again when payment starts, so a code is checked against what the cart holds when the buyer pays. If the discount changed since the buyer last saw it, no payment starts and checkout says so (`discount_changed`). This is like a price change.
- **Codes are entered at checkout** (`POST /store/carts/:id/checkout/promo-codes`, `DELETE …/:code`). Case doesn't matter. A code that can't be used is refused with the reason: not a code (or still a draft), expired (ended or stopped), not on yet, used up (its own limit or its campaign's budget), or not for anything in the cart. A shop's code names the shop. The store's own promotions route is closed.
- **Who funds a discount** (`ojaShareOf`): the operator's choice in the admin panel (`promotion_cost`) when there is one. Otherwise a shop's own promotion is the shop's, and an operator promotion is Oja's. Each order records Oja's share of every promotion on its items when it is placed (`discount_funding`, written with the order's fulfilment row), so changing a promotion afterwards doesn't change the order. This is what Mercur's admin promises.
- **Payouts add back what Oja funds** (`ojaFundedDiscount`, `payoutOf`): Oja's share of each line's discounts, VAT included, for the units still on the order. A line placed with 4 units and 1 removed counts 3 quarters of its discount. The 10% commission is worked out after the add-back, so an Oja-funded promotion leaves the shop's payout as if the buyer had paid in full. A shop-funded discount stays off its payout. The payout row keeps the add-back (`oja_discount`).
- **Deal badges** (`dealsOf`): each listing carries its shop's running automatic promotions that would discount one of the product's offers in a cart of its own. They are worked out by the promotion module with a one-item cart. Badges never show another shop's promotion. A promotion that depends on the buyer (a customer group) or on the rest of the cart gets no badge.

## Consequences

- **Moving a shop's items to a cart of their own (#11).** Discounts follow items. A shop's discount belongs to its own items, so it moves with them. An operator discount across the whole cart is worked out again on each cart's current items when payment starts, so a fixed amount is never counted twice. A code's usage limit is counted once per payment: Mercur registers a code's use when a paid cart becomes orders.
- Every cart change works promotions out once for the whole cart and once per shop in it. Carts hold few shops, so this costs a few queries.
- A cart changed only through Medusa's own routes (not the app's) can show Medusa's cross-shop discounts until checkout's next step. Payment always works them out again first, so they are never paid for.
- A code whose last qualifying item leaves the cart is dropped, and the buyer enters it again.
- Nothing reserves a code's last use before payment. If two buyers pay with it at once, Medusa refuses to register the second use ("Promotion usage exceeds the limit"), so the second paid cart doesn't become orders. Nothing refunds that payment yet: it needs a follow-up.
- Mercur's admin preselects "Store" as an operator promotion's cost bearer. An operator who saves that makes the shops fund it. Leaving the cost unset (or choosing Marketplace) makes it Oja's.
