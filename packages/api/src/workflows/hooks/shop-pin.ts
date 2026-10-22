import { StepResponse } from "@medusajs/framework/workflows-sdk"
import { updateSellerAddressWorkflow } from "@mercurjs/core/workflows"
import { pinOf } from "@oja/domain"
import { setShopPin, shopPinOf } from "../../lib/shop-pins"

// Listings measure from a copy of each shop's pickup pin that SQL can read (ADR 0014). Every write
// of a shop's pickup address goes through Mercur's address workflow: the onboarding checklist,
// the vendor panel's and admin's address routes, a new seller account, and the seed. The copy
// follows each one, and goes back if the workflow rolls back.

type SavedAddress = { seller_id?: string | null; metadata?: Record<string, unknown> | null }

updateSellerAddressWorkflow.hooks.addressUpdated(
  async ({ address }, { container }) => {
    const { seller_id, metadata } = address as unknown as SavedAddress
    if (!seller_id) return new StepResponse(undefined, null)
    const previous = await shopPinOf(container, seller_id)
    await setShopPin(container, seller_id, pinOf({ metadata }))
    return new StepResponse(undefined, { seller_id, previous })
  },
  async (undo, { container }) => {
    if (undo) await setShopPin(container, undo.seller_id, undo.previous)
  }
)
