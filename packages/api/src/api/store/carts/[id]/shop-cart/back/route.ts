import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { retrieveCartBySeller } from "../../../../../../lib/cart"
import { moveShopCartBackWorkflow } from "../../../../../../workflows/checkout/shop-cart"
import { answeringAlreadyPaid } from "../../../already-paid"
import type { StoreShopCartResponse } from "../route"
import type { StoreMoveShopCartBackType } from "../validators"

/**
 * The buyer went back from a shop cart's checkout without paying (#11): its items and codes move
 * back to the cart they came from, returned by shop, and the shop cart is emptied. Its Paystack
 * page then places no order, and paying it is refunded. A shop cart already paid for is refused
 * (409): its order is on the way.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<StoreMoveShopCartBackType>,
  res: MedusaResponse<StoreShopCartResponse>
) =>
  answeringAlreadyPaid(res, async () => {
    await moveShopCartBackWorkflow(req.scope).run({
      input: { cartId: req.params.id, shopCartId: req.validatedBody.shop_cart_id, customerId: req.auth_context.actor_id },
    })
    res.json({ cart: await retrieveCartBySeller(req.scope, req.params.id) })
  })
