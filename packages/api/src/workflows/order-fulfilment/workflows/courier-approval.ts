import { releaseLockStep } from "@medusajs/medusa/core-flows"
import { MedusaError } from "@medusajs/framework/utils"
import { StepResponse, WorkflowResponse, createStep, createWorkflow } from "@medusajs/framework/workflows-sdk"
import type { CourierApproval } from "../../../lib/label-booking"
import { asFulfilmentRecord, fulfilmentService, fulfilmentsOf } from "../../../lib/order-fulfilment"
import { lockOrderFulfilment } from "../compose"

/** `approval`: the courier now waiting for Oja's team to approve it, or null once they decline it. */
export type SetCourierApprovalInput = { order_id: string; approval: CourierApproval | null }

/**
 * Keeps the courier waiting for approval on the packed order's fulfilment row, or clears it.
 * Refused for an order that isn't packed: its label is booked, or it was cancelled meanwhile.
 */
const setCourierApprovalStep = createStep(
  "set-courier-approval",
  async ({ order_id, approval }: SetCourierApprovalInput, { container }) => {
    const record = (await fulfilmentsOf(container, [order_id])).get(order_id)
    if (record?.state !== "packed") {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Order ${order_id} isn't packed, so its courier can't be changed`)
    }
    const saved = await fulfilmentService(container).updateOrderFulfilments({ id: record.id, courier_approval: approval })
    return new StepResponse(asFulfilmentRecord(saved), { id: record.id, previous: record.courier_approval })
  },
  async (compensation, { container }) => {
    if (!compensation) return
    await fulfilmentService(container).updateOrderFulfilments({ id: compensation.id, courier_approval: compensation.previous })
  }
)

/**
 * A courier staff chose above the top-up cap waits for Oja's team to approve it (#19), or the
 * team declines it, under the order's fulfilment lock so it can't cross a label being booked.
 */
export const setCourierApprovalWorkflow = createWorkflow("set-courier-approval", (input: SetCourierApprovalInput) => {
  const lock = lockOrderFulfilment(input)
  const fulfilment = setCourierApprovalStep(input)
  releaseLockStep({ key: lock })
  return new WorkflowResponse(fulfilment)
})
