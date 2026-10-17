import { Modules } from "@medusajs/framework/utils"
import { StepResponse } from "@medusajs/framework/workflows-sdk"
import { completeCartWithSplitOrdersWorkflow } from "@mercurjs/core/workflows"
import { codesCountedElsewhere } from "../../lib/shared-codes"

// A code on both a cart and its shop cart counts one use (#11, ADR 0010). Mercur registers a use
// of each code on a cart's discounts when the paid cart becomes orders, and checks the code's
// usage limit as it does. For a code whose use a cart sharing it already counted, the use is
// taken back here first, so registering it again leaves one use, and a single-use code fits.
// A spend budget still counts what each cart took off: nothing is taken back from it.

type CompletingCart = {
  id: string
  completed_at?: string | Date | null
  email?: string | null
  customer?: { id: string } | null
  items?: { adjustments?: { code?: string | null }[] | null }[] | null
  shipping_methods?: { adjustments?: { code?: string | null }[] | null }[] | null
}

type TakenBack = { codes: string[]; context: { customer_id: string | null; customer_email: string | null } }

completeCartWithSplitOrdersWorkflow.hooks.validate(
  async ({ cart }, { container }) => {
    const completing = cart as CompletingCart
    // A completion run again for a cart already completed registers nothing again.
    if (completing.completed_at) return new StepResponse(undefined, null)
    const discounting = new Set(
      [...(completing.items ?? []), ...(completing.shipping_methods ?? [])].flatMap((line) =>
        (line.adjustments ?? []).flatMap((a) => (a.code ? [a.code] : []))
      )
    )
    const codes = (await codesCountedElsewhere(container, completing.id)).filter((code) => discounting.has(code))
    if (!codes.length) return new StepResponse(undefined, null)
    const context = { customer_id: completing.customer?.id ?? null, customer_email: completing.email ?? null }
    await container.resolve(Modules.PROMOTION).revertUsage(
      codes.map((code) => ({ code, amount: 0 })),
      context
    )
    return new StepResponse<undefined, TakenBack | null>(undefined, { codes, context })
  },
  async (takenBack: TakenBack | null | undefined, { container }) => {
    // The cart didn't become orders: the use goes back to the cart that counted it.
    if (!takenBack) return
    await container.resolve(Modules.PROMOTION).registerUsage(
      takenBack.codes.map((code) => ({ code, amount: 0 })),
      takenBack.context
    )
  }
)
