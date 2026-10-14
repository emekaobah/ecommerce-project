import { checkPickupCode, type PickupCodeCheck } from "@oja/domain"
import { MedusaError } from "@medusajs/framework/utils"
import { emitEventStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { StepResponse, WorkflowResponse, createStep, createWorkflow, transform, when } from "@medusajs/framework/workflows-sdk"
import { fulfilmentService, fulfilmentsOf, ORDER_COLLECTED } from "../../../lib/order-fulfilment"
import { checkOrderLiveStep } from "../steps/check-order-live"
import { transitionFulfilmentStep } from "../steps/transition-fulfilment"
import { lockOrderFulfilment } from "../compose"

export type CollectOrderInput = {
  order_id: string
  /** The member handing the order over. */
  actor: string
  /** The code the collector showed (scanned or typed). */
  code: string
  /** The collector's name, as they gave it. */
  collected_by: string
}

/**
 * Checks the code shown at the counter against the order's (#12). A code is taken only while the
 * order is Ready for pickup; a wrong one is counted on the order, and is kept counted whatever the
 * workflow does next, so the attempt limit holds.
 */
const checkPickupCodeStep = createStep(
  "check-pickup-code",
  async ({ order_id, code }: Pick<CollectOrderInput, "order_id" | "code">, { container }) => {
    const record = (await fulfilmentsOf(container, [order_id])).get(order_id)
    if (record?.fulfilment.state !== "ready_for_pickup") {
      const what = record?.fulfilment.method === "delivery" ? "is delivered, not collected" : "isn't ready for pickup"
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Order ${order_id} ${what}: no pickup code is taken`)
    }
    const check = checkPickupCode({ code: record.pickup_code, wrongAttempts: record.pickup_code_attempts ?? [] }, code, new Date())
    if (!check.ok && check.reason === "wrong_code") {
      await fulfilmentService(container).updateOrderFulfilments({ id: record.id, pickup_code_attempts: check.wrongAttempts })
    }
    return new StepResponse<PickupCodeCheck>(check)
  }
)

/**
 * Staff hand a pickup order over at the counter against its code (#12): all of it, whoever holds
 * the code, in or out of opening hours. The right code moves it to Collected, recording the
 * member, when, and the collector's name, and makes it payout-eligible. Returns the code's check,
 * and the fulfilment when it checked out.
 */
export const collectOrderWorkflow = createWorkflow("collect-order", (input: CollectOrderInput) => {
  const lock = lockOrderFulfilment(input)
  checkOrderLiveStep({ order_id: input.order_id })
  const check = checkPickupCodeStep({ order_id: input.order_id, code: input.code })
  const fulfilment = when("pickup-code-checks-out", { check }, ({ check }) => check.ok).then(() => {
    const trigger = transform({ input }, ({ input }) => ({
      source: "staff" as const,
      type: "collect" as const,
      actor: input.actor,
      at: new Date().toISOString(),
      collectedBy: input.collected_by,
    }))
    const collected = transitionFulfilmentStep({ order_id: input.order_id, trigger })
    emitEventStep({ eventName: ORDER_COLLECTED, data: { id: input.order_id } })
    return collected
  })
  releaseLockStep({ key: lock })
  return new WorkflowResponse({ check, fulfilment })
})
