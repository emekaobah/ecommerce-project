import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { retrieveCartBySeller, type CartBySeller } from "../../../../../lib/cart"
import { moveShopToOwnCartWorkflow } from "../../../../../workflows/checkout/shop-cart"
import { answeringAlreadyPaid } from "../../already-paid"
import type { StoreMoveShopToOwnCartType } from "./validators"

export type StoreShopCartResponse = { cart: CartBySeller }

/**
 * "Pay for this shop only" (#11): moves the shop's items out of the buyer's cart into a shop cart,
 * returned by shop, which the app then checks out. The cart keeps the other shops' items. A cart
 * already paid for is refused (409): its order is on the way.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<StoreMoveShopToOwnCartType>,
  res: MedusaResponse<StoreShopCartResponse>
) =>
  answeringAlreadyPaid(res, async () => {
    const { result: shopCartId } = await moveShopToOwnCartWorkflow(req.scope).run({
      input: { cartId: req.params.id, customerId: req.auth_context.actor_id, sellerId: req.validatedBody.seller_id },
    })
    res.json({ cart: await retrieveCartBySeller(req.scope, shopCartId) })
  })
