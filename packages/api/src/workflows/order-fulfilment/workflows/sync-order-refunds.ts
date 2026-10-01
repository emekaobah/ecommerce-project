import type { IOrderModuleService, IPaymentModuleService } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { StepResponse, WorkflowResponse, createStep, createWorkflow } from "@medusajs/framework/workflows-sdk"
import { fulfilmentService, type OrderRefundRecord } from "../../../lib/order-fulfilment"
import { paystackClient } from "../../../modules/paystack"
import type { PaystackRefundStatus } from "../../../modules/paystack/client"

const UNSETTLED: PaystackRefundStatus[] = ["pending", "processing", "needs-attention"]

type Change = { id: string; from: PaystackRefundStatus; to: PaystackRefundStatus; row: OrderRefundRecord }

/** Paystack's word on each unsettled order refund of the transaction, where it has moved on. */
const fetchRefundChangesStep = createStep("fetch-order-refund-changes", async ({ transaction_reference: reference }: { transaction_reference: string }, { container }) => {
  const paystack = paystackClient()
  if (!paystack) return new StepResponse([] as Change[])
  const rows = (await fulfilmentService(container).listOrderRefunds({
    transaction_reference: reference,
    status: UNSETTLED,
  })) as OrderRefundRecord[]
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const changes: Change[] = []
  for (const row of rows) {
    if (!row.paystack_refund_id) {
      logger.warn(`Order refund ${row.id} has no Paystack refund id to check`)
      continue
    }
    const { status } = await paystack.fetchRefund(row.paystack_refund_id)
    if (status !== row.status) changes.push({ id: row.id, from: row.status, to: status, row })
  }
  return new StepResponse(changes)
})

const updateRefundStatusesStep = createStep(
  "update-order-refund-statuses",
  async (changes: Change[], { container }) => {
    if (changes.length) await fulfilmentService(container).updateOrderRefunds(changes.map((c) => ({ id: c.id, status: c.to })))
    return new StepResponse(undefined, changes)
  },
  async (changes: Change[] | undefined, { container }) => {
    if (changes?.length) {
      await fulfilmentService(container).updateOrderRefunds(changes.map((c) => ({ id: c.id, status: c.from })))
    }
  }
)

/**
 * A failed refund (Paystack credited the money back) no longer counts as refunded: its order
 * transaction and Medusa refund are removed, so the order may be refunded again.
 */
const unrecordFailedRefundsStep = createStep("unrecord-failed-order-refunds", async (changes: Change[], { container }) => {
  const failed = changes.filter((c) => c.to === "failed").map((c) => c.row)
  if (!failed.length) return new StepResponse(undefined)
  const orderModule = container.resolve<IOrderModuleService>(Modules.ORDER)
  const transactions = await orderModule.listOrderTransactions({
    reference: "refund",
    reference_id: failed.map((row) => row.refund_id),
  })
  if (transactions.length) await orderModule.deleteOrderTransactions(transactions.map((t) => t.id))
  await container.resolve<IPaymentModuleService>(Modules.PAYMENT).deleteRefunds(failed.map((row) => row.refund_id))
  return new StepResponse(undefined)
})

/**
 * Brings the order refunds of a Paystack transaction up to date. Paystack's `refund.*`
 * webhooks name the transaction but not the refund, so each unsettled refund is fetched by
 * its id.
 */
export const syncOrderRefundsWorkflow = createWorkflow("sync-order-refunds", (input: { transaction_reference: string }) => {
  const changes = fetchRefundChangesStep(input)
  updateRefundStatusesStep(changes)
  unrecordFailedRefundsStep(changes)
  return new WorkflowResponse(changes)
})
