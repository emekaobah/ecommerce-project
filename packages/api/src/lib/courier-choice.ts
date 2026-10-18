import { formatMoney } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { bookLabelWorkflow } from "../workflows/order-fulfilment/workflows/book-label"
import { setCourierApprovalWorkflow } from "../workflows/order-fulfilment/workflows/courier-approval"
import {
  approvedBooking,
  decideLabel,
  quoteLabel,
  type CourierApproval,
  type CourierOption,
  type CourierPick,
  type LabelBooking,
} from "./label-booking"
import { asFulfilmentRecord, fulfilmentService, fulfilmentsOf, type FulfilmentRecord } from "./order-fulfilment"

// Which courier a packed order's label is booked with (#19): the platform pays up to the top-up
// cap above the buyer's checkout price by itself; above it, staff choose a courier, and one
// still above the cap waits for Oja's team to approve it in the admin.

type Scope = Pick<MedusaContainer, "resolve">

/** What booking a label came to: the order's fulfilment, and the couriers staff choose from when it wasn't booked. */
export type LabelOutcome = { fulfilment: FulfilmentRecord; courier_options: CourierOption[] | null }

/** The packed order's fulfilment row; refused for an order that isn't packed. */
async function packedOrder(scope: Scope, orderId: string): Promise<FulfilmentRecord> {
  const record = (await fulfilmentsOf(scope, [orderId])).get(orderId)
  if (record?.state !== "packed") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Order ${orderId} isn't packed: book its courier label once it is`)
  }
  return record
}

async function book(scope: Scope, orderId: string, booking: LabelBooking, actor: string) {
  const { result } = await bookLabelWorkflow(scope as MedusaContainer).run({ input: { order_id: orderId, booking, actor } })
  return result
}

/** The order's number, its shop's name and its currency, as Oja's team read them. */
async function orderLabel(scope: Scope, orderId: string) {
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "order",
    fields: ["id", "display_id", "currency_code", "seller.name"],
    filters: { id: orderId },
  })
  const order = data[0] as unknown as { display_id: number; currency_code: string; seller?: { name: string } | null }
  return { display_id: order.display_id, currency_code: order.currency_code, shop: order.seller?.name ?? null }
}

/** Tells Oja's team, in the admin's notifications, that a courier waits for their approval. */
async function askOjaToApprove(scope: Scope, orderId: string, approval: CourierApproval) {
  const { display_id, currency_code, shop } = await orderLabel(scope, orderId)
  const money = (amount: number) => formatMoney(amount, currency_code)
  const description =
    `${shop ?? "A shop"} wants to book ${approval.courier_name} for order #${display_id} at ${money(approval.amount)}, ` +
    `${money(approval.difference)} more than the buyer paid at checkout. Approve or decline it under Courier approvals.`
  await scope.resolve(Modules.NOTIFICATION).createNotifications({
    to: "",
    channel: "feed",
    template: "admin-ui",
    data: { title: `Courier for order #${display_id} to approve`, description },
    idempotency_key: `courier-approval:${orderId}:${approval.requested_at}`,
  })
}

/**
 * Staff book the packed order's courier label (`POST /vendor/orders/:id/book-label`), quoted
 * now (`decideLabel`). Without a courier picked: the one `rateToBook` finds, when within the
 * cap; otherwise nothing is booked and the couriers come back to choose from. With one picked:
 * booked when within the cap, otherwise kept for Oja's team to approve, who are notified.
 */
export async function bookOrderLabel(
  scope: Scope,
  { order_id, actor, courier }: { order_id: string; actor: string; courier?: CourierPick }
): Promise<LabelOutcome> {
  const record = await packedOrder(scope, order_id)
  const decision = decideLabel(await quoteLabel(scope as MedusaContainer, order_id), courier)
  if (decision.action === "book") return { fulfilment: await book(scope, order_id, decision.booking, actor), courier_options: null }
  if (decision.action === "choose") return { fulfilment: record, courier_options: decision.options }
  const approval: CourierApproval = { ...decision.courier, requested_by: actor, requested_at: new Date().toISOString() }
  const { result } = await setCourierApprovalWorkflow(scope as MedusaContainer).run({ input: { order_id, approval } })
  await askOjaToApprove(scope, order_id, approval)
  return { fulfilment: result, courier_options: null }
}

/** The courier waiting for approval on the packed order, or a 404. */
async function waitingApproval(scope: Scope, orderId: string): Promise<CourierApproval> {
  const approval = (await fulfilmentsOf(scope, [orderId])).get(orderId)?.courier_approval
  if (!approval) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${orderId} has no courier waiting for approval`)
  return approval
}

/**
 * Oja's team approve the courier waiting on the order: it is quoted again and booked at its
 * price now (`approvedBooking`), by the operator. Refused when it no longer quotes.
 */
export async function approveCourier(scope: Scope, { order_id, actor }: { order_id: string; actor: string }): Promise<FulfilmentRecord> {
  const approval = await waitingApproval(scope, order_id)
  await packedOrder(scope, order_id)
  return book(scope, order_id, approvedBooking(await quoteLabel(scope as MedusaContainer, order_id), approval), actor)
}

/** Oja's team decline the courier waiting on the order: the shop chooses again. */
export async function declineCourier(scope: Scope, orderId: string): Promise<FulfilmentRecord> {
  await waitingApproval(scope, orderId)
  const { result } = await setCourierApprovalWorkflow(scope as MedusaContainer).run({ input: { order_id: orderId, approval: null } })
  return result
}

/** A courier waiting for Oja's team to approve it, as the admin lists it. */
export type AdminCourierApproval = {
  order_id: string
  display_id: number
  shop: string | null
  currency_code: string
  courier: CourierApproval
}

/** Every packed order's courier waiting for approval, longest waiting first: the admin's Courier approvals. */
export async function courierApprovals(scope: Scope): Promise<AdminCourierApproval[]> {
  const rows = (await fulfilmentService(scope).listOrderFulfilments({ state: "packed", courier_approval: { $ne: null } })).map(
    asFulfilmentRecord
  )
  const waiting = rows.flatMap((r) => (r.courier_approval ? [{ order_id: r.order_id, courier: r.courier_approval }] : []))
  const labels = await Promise.all(waiting.map((w) => orderLabel(scope, w.order_id)))
  return waiting
    .map((w, i) => ({ ...w, ...labels[i] }))
    .sort((a, b) => a.courier.requested_at.localeCompare(b.courier.requested_at))
}
