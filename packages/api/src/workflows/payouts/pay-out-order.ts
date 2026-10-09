import { acquireLockStep, createRemoteLinkStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import type { LinkDefinition } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { StepResponse, WorkflowResponse, createStep, createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { MercurModules, type PayoutDTO } from "@mercurjs/types"
import { fulfilmentService } from "../../lib/order-fulfilment"
import { payoutToMake, type PayoutToMake } from "../../lib/payouts"
import { paystackClient } from "../../modules/paystack"
import type { PaystackPayoutData } from "../../modules/paystack-payout/service"

type PayoutService = {
  createPayouts(input: {
    account_id: string
    amount: number
    currency_code: string
    data: Record<string, unknown>
  }): Promise<PayoutDTO>
}

export type PayOutOrderInput = {
  order_id: string
  /** What the shop owes back for refunds after its earlier payouts, taken out of this one. */
  owed_back: number
}

const workOutPayoutStep = createStep("work-out-order-payout", async (input: PayOutOrderInput, { container }) => {
  return new StepResponse(await payoutToMake(container, input.order_id, input.owed_back))
})

/** The order's payout record, written before the transfer so the order is never paid twice. */
const recordOrderPayoutStep = createStep(
  "record-order-payout",
  async (payout: PayoutToMake, { container }) => {
    const { breakdown } = payout
    const row = await fulfilmentService(container).createShopPayouts({
      order_id: payout.order_id,
      seller_id: payout.seller_id,
      currency_code: payout.currency_code,
      ...breakdown,
      recovered: payout.recovered,
      attempt: payout.attempt,
      transfer_reference: payout.reference,
    })
    return new StepResponse(row, row.id)
  },
  async (id: string | undefined, { container }) => {
    if (!id) return
    const [row] = await fulfilmentService(container).listShopPayouts({ id }, { take: 1 })
    // Paystack took the transfer and something after it failed: the order was paid, so it stays
    // recorded and isn't paid again. Its payout must be put right by hand.
    const transfer = row && (await paystackClient()?.verifyTransfer(row.transfer_reference).catch(() => null))
    if (transfer) {
      container
        .resolve(ContainerRegistrationKeys.LOGGER)
        .error(`Order ${row.order_id} was paid out (transfer ${row.transfer_reference}) but its payout wasn't recorded`)
      return
    }
    await fulfilmentService(container).deleteShopPayouts(id)
  }
)

/** Asks Paystack to transfer the payout, through Mercur's payout module: it keeps the payout and its status. */
const transferPayoutStep = createStep("transfer-order-payout", async (payout: PayoutToMake, { container }) => {
  const data: PaystackPayoutData = {
    recipient_code: payout.recipient_code,
    reference: payout.reference,
    reason: payout.reason,
  }
  const created = await container.resolve<PayoutService>(MercurModules.PAYOUT).createPayouts({
    account_id: payout.account_id,
    amount: payout.transfer,
    currency_code: payout.currency_code,
    data: { ...data, order_id: payout.order_id },
  })
  // Money sent can't be called back: nothing to compensate.
  return new StepResponse(created)
})

const notePayoutStep = createStep("note-order-payout", async (input: { id: string; payout_id: string }, { container }) => {
  return new StepResponse(await fulfilmentService(container).updateShopPayouts(input))
})

/**
 * Pays a delivered order out to its shop (#29): what the buyer kept, less delivery and 10%
 * commission, less what the shop owes back for refunds after its earlier payouts. Refunds of the
 * order wait for the payout and the payout for them, so it never misses one.
 */
export const payOutOrderWorkflow = createWorkflow("pay-out-order", (input: PayOutOrderInput) => {
  const key = transform({ input }, ({ input }) => `order-refund:${input.order_id}`)
  acquireLockStep({ key, timeout: 10, ttl: 60 })
  const payout = workOutPayoutStep(input)
  const row = recordOrderPayoutStep(payout)
  const transferred = transferPayoutStep(payout)
  const links = transform({ payout, transferred }, ({ payout, transferred }): LinkDefinition[] => [
    { [Modules.ORDER]: { order_id: payout.order_id }, [MercurModules.PAYOUT]: { payout_id: transferred.id } },
    { [MercurModules.PAYOUT]: { payout_id: transferred.id }, [MercurModules.SELLER]: { seller_id: payout.seller_id } },
  ])
  createRemoteLinkStep(links)
  const noted = notePayoutStep(transform({ row, transferred }, ({ row, transferred }) => ({ id: row.id, payout_id: transferred.id })))
  releaseLockStep({ key })
  return new WorkflowResponse(noted)
})
