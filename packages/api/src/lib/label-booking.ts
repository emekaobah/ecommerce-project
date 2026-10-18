import { formatMoney } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import type { ShipbubbleLabelRequest, ShipbubbleMethodData, ShipbubbleQuote } from "../modules/shipbubble"
import { addressCodeOf, quoteRates, type DeliveryAddress } from "./delivery"

// Booking a packed order's courier label (#24, docs/design.md "Order state machine"), and the
// cap on what the platform pays above the buyer's checkout price for it (#19).

type Scope = Pick<MedusaContainer, "resolve">

/** A courier as the order knows it: Shipbubble's ids for it, its name and its price. */
export type Courier = { courier_id: string; service_code: string; courier_name: string; amount: number }

/** The courier rate a label is booked with: what Shipbubble books it by, its price and when it delivers (ISO 8601). */
export type LabelRate = ShipbubbleLabelRequest & Courier & { delivery_eta_time: string }

/**
 * What booking an order's label needs: the rate to book, the courier the buyer chose at checkout
 * and what it cost them, and the order's lines to fulfil.
 */
export type LabelBooking = { rate: LabelRate; chosen: Courier; items: { id: string; quantity: number }[] }

/** A courier staff may book instead, when the one booking would pick costs the platform more than the cap. */
export type CourierOption = Courier & {
  /** ISO 8601. */
  delivery_eta_time: string
  /** What it costs above the buyer's checkout price (negative when it costs less). */
  difference: number
  /** Whether booking it is within the cap; above it, Oja's team approve it first. */
  within_cap: boolean
}

/** A courier staff chose that costs the platform more than the cap, waiting for Oja's team to approve it (#19). */
export type CourierApproval = Courier & {
  /** ISO 8601, as it was quoted when staff chose it. */
  delivery_eta_time: string
  /** What the buyer's courier cost at checkout. */
  checkout_amount: number
  difference: number
  /** The member who chose it. */
  requested_by: string
  /** ISO 8601. */
  requested_at: string
}

/** A courier staff pick by Shipbubble's ids for it. */
export type CourierPick = Pick<Courier, "courier_id" | "service_code">

type OrderRow = {
  id: string
  currency_code: string
  seller?: { id: string } | null
  shipping_address?: DeliveryAddress | null
  items?: { id: string; title: string; product_title?: string | null; variant_id: string | null; quantity: number; unit_price: number }[] | null
  shipping_methods?: { data?: Partial<ShipbubbleMethodData> | null }[] | null
}

/** The order's parcel quoted now: every courier's rate, the buyer's choice at checkout, its lines, and the cap. */
export type LabelQuote = {
  rates: ShipbubbleQuote[]
  chosen: ShipbubbleQuote
  items: LabelBooking["items"]
  /** The most the platform pays above the buyer's checkout price without Oja's team approving it. */
  cap: number
  currency_code: string
}

/** Where the cap is kept: the store's metadata, set by Oja's team in the admin. */
export const TOP_UP_CAP_KEY = "courier_top_up_cap"
/** The cap until Oja's team set one: ₦1,000 per shipment. */
export const DEFAULT_TOP_UP_CAP = 1000

const etaOf = (rate: Pick<ShipbubbleQuote, "delivery_eta_time">) => new Date(rate.delivery_eta_time).getTime()
export const sameCourier = (a: CourierPick, b: CourierPick) => a.courier_id === b.courier_id && a.service_code === b.service_code
const courierOf = ({ courier_id, service_code, courier_name, amount }: Courier): Courier => ({ courier_id, service_code, courier_name, amount })

/**
 * The rate to book from a fresh quote: the courier the buyer chose at checkout when it still
 * takes the parcel; otherwise the cheapest arriving no later than the buyer's choice would
 * have; otherwise the fastest. The buyer's quote can't be booked as it is: its request token
 * is from checkout, and a rebook comes later still.
 */
export function rateToBook(rates: ShipbubbleQuote[], chosen: ShipbubbleQuote | undefined): ShipbubbleQuote | undefined {
  const same = chosen && rates.find((r) => sameCourier(r, chosen))
  if (same) return same
  const inTime = chosen ? rates.filter((r) => etaOf(r) <= etaOf(chosen)) : []
  if (inTime.length) return [...inTime].sort((a, b) => a.amount - b.amount)[0]
  return [...rates].sort((a, b) => etaOf(a) - etaOf(b))[0]
}

async function theStore(scope: Scope) {
  const [store] = await scope.resolve(Modules.STORE).listStores({}, { select: ["id", "metadata"], take: 1 })
  if (!store) throw new MedusaError(MedusaError.Types.NOT_FOUND, "The store isn't set up")
  return store
}

/** The top-up cap Oja's team set, or the default. */
export async function topUpCap(scope: Scope): Promise<number> {
  const cap = (await theStore(scope)).metadata?.[TOP_UP_CAP_KEY]
  return typeof cap === "number" ? cap : DEFAULT_TOP_UP_CAP
}

/** Sets the top-up cap (#19): a flat amount per shipment, in the store's currency. */
export async function setTopUpCap(scope: Scope, cap: number): Promise<number> {
  const store = await theStore(scope)
  await scope.resolve(Modules.STORE).updateStores(store.id, { metadata: { ...store.metadata, [TOP_UP_CAP_KEY]: cap } })
  return cap
}

/**
 * The order's parcel quoted now, from the shop's pickup address to the buyer's. Refused (400)
 * when the order has no delivery to book.
 */
export async function quoteLabel(scope: MedusaContainer, orderId: string): Promise<LabelQuote> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "currency_code",
      "seller.id",
      "shipping_address.*",
      // An order line's quantity comes from its detail, which only `*` asks for.
      "items.*",
      "shipping_methods.data",
    ],
    filters: { id: orderId },
  })
  const order = data[0] as OrderRow | undefined
  if (!order) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order with id: ${orderId} was not found`)
  const receiverCode = addressCodeOf(order.shipping_address)
  const chosen = order.shipping_methods?.map((m) => m.data?.quote).find((q): q is ShipbubbleQuote => !!q)
  if (!order.seller || receiverCode == null || !chosen) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Order ${orderId} has no courier delivery to book`)
  }
  const items = (order.items ?? []).filter((i) => Number(i.quantity) > 0)
  const [rates, cap] = await Promise.all([
    quoteRates(scope, {
      sellerId: order.seller.id,
      receiverCode,
      currencyCode: order.currency_code,
      lines: items
        .filter((i): i is typeof i & { variant_id: string } => !!i.variant_id)
        .map((i) => ({
          variant_id: i.variant_id,
          title: i.product_title ?? i.title,
          quantity: Number(i.quantity),
          unit_price: Number(i.unit_price),
        })),
    }),
    topUpCap(scope),
  ])
  return { rates, chosen, items: items.map((i) => ({ id: i.id, quantity: Number(i.quantity) })), cap, currency_code: order.currency_code }
}

/** What to do about the order's label: book a rate, have staff choose a courier, or ask Oja's team to approve one. */
export type LabelDecision =
  | { action: "book"; booking: LabelBooking }
  | { action: "choose"; options: CourierOption[] }
  | { action: "approve"; courier: Omit<CourierApproval, "requested_by" | "requested_at"> }

const NO_COURIER = "No courier will collect this parcel right now. Try again later."

function bookingOf({ chosen, items }: LabelQuote, rate: ShipbubbleQuote): LabelBooking {
  return {
    rate: { request_token: rate.request_token, ...courierOf(rate), delivery_eta_time: rate.delivery_eta_time },
    chosen: courierOf(chosen),
    items,
  }
}

/**
 * What booking the order's label comes to (#19). Staff booking without picking a courier get
 * `rateToBook`'s, when it costs the platform no more than the cap above the buyer's checkout
 * price; otherwise every courier quoting now, to choose from. A courier staff pick is booked
 * when within the cap, and otherwise waits for Oja's team to approve it. Refused (400) when no
 * courier takes the parcel, or the one picked no longer quotes.
 */
export function decideLabel(quote: LabelQuote, pick?: CourierPick): LabelDecision {
  const { rates, chosen, cap } = quote
  const differenceOf = (rate: ShipbubbleQuote) => rate.amount - chosen.amount
  const automatic = rateToBook(rates, chosen)
  // Staff choose only when booking wouldn't book a courier by itself.
  if (pick && automatic && differenceOf(automatic) <= cap) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Book the label without choosing a courier: one is booked within what Oja tops up.")
  }
  const rate = pick ? rates.find((r) => sameCourier(r, pick)) : automatic
  if (!rate) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, pick ? "That courier no longer collects this parcel. Choose another." : NO_COURIER)
  }
  if (differenceOf(rate) <= cap) return { action: "book", booking: bookingOf(quote, rate) }
  if (pick) {
    return {
      action: "approve",
      courier: { ...courierOf(rate), delivery_eta_time: rate.delivery_eta_time, checkout_amount: chosen.amount, difference: differenceOf(rate) },
    }
  }
  const options = [...rates]
    .sort((a, b) => a.amount - b.amount || etaOf(a) - etaOf(b))
    .map((r) => ({
      ...courierOf(r),
      delivery_eta_time: r.delivery_eta_time,
      difference: differenceOf(r),
      within_cap: differenceOf(r) <= cap,
    }))
  return { action: "choose", options }
}

/**
 * The booking of a courier Oja's team approved, at its price now, whatever the cap, as long as
 * that is no more than the price staff asked them to approve. Refused (400) when it no longer
 * quotes, or now costs more: Oja's team decline it, and the shop chooses again.
 */
export function approvedBooking(quote: LabelQuote, approved: Pick<CourierApproval, "courier_id" | "service_code" | "amount">): LabelBooking {
  const rate = quote.rates.find((r) => sameCourier(r, approved))
  if (!rate) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "That courier no longer collects this parcel. Decline it, so the shop chooses another.")
  }
  if (rate.amount > approved.amount) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `${rate.courier_name} now costs ${formatMoney(rate.amount, quote.currency_code)}, more than the ` +
        `${formatMoney(approved.amount, quote.currency_code)} asked for. Decline it, so the shop chooses again.`
    )
  }
  return bookingOf(quote, rate)
}
