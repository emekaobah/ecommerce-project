import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"

/**
 * Refuses (as not allowed) moving the delivery of an order cancelled meanwhile: a late courier
 * update or a staff tap must not deliver it, nor make a refunded order payout-eligible (#25).
 */
export const checkOrderLiveStep = createStep("check-order-live", async ({ order_id }: { order_id: string }, { container }) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "order", fields: ["status"], filters: { id: order_id } })
  if (data[0]?.status === "canceled") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Order ${order_id} was cancelled`)
  }
  return new StepResponse(undefined)
})
