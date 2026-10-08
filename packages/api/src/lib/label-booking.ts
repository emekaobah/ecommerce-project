import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { ShipbubbleLabelRequest, ShipbubbleMethodData, ShipbubbleQuote } from "../modules/shipbubble"
import { addressCodeOf, quoteRates, type DeliveryAddress } from "./delivery"

// Booking a packed order's courier label (#24, docs/design.md "Order state machine").

/** The courier rate a label is booked with, and the courier's name. */
export type LabelRate = ShipbubbleLabelRequest & { courier_name: string }

/** What booking an order's label needs: the rate to book, and the order's lines to fulfil. */
export type LabelBooking = { rate: LabelRate; items: { id: string; quantity: number }[] }

type OrderRow = {
  id: string
  currency_code: string
  seller?: { id: string } | null
  shipping_address?: DeliveryAddress | null
  items?: { id: string; title: string; product_title?: string | null; variant_id: string | null; quantity: number; unit_price: number }[] | null
  shipping_methods?: { data?: Partial<ShipbubbleMethodData> | null }[] | null
}

const etaOf = (rate: Pick<ShipbubbleQuote, "delivery_eta_time">) => new Date(rate.delivery_eta_time).getTime()

/**
 * The rate to book from a fresh quote: the courier the buyer chose at checkout when it still
 * takes the parcel; otherwise the cheapest arriving no later than the buyer's choice would
 * have; otherwise the fastest. The buyer's quote can't be booked as it is: its request token
 * is from checkout, and a rebook comes later still.
 */
export function rateToBook(rates: ShipbubbleQuote[], chosen: ShipbubbleQuote | undefined): ShipbubbleQuote | undefined {
  const same = chosen && rates.find((r) => r.courier_id === chosen.courier_id && r.service_code === chosen.service_code)
  if (same) return same
  const inTime = chosen ? rates.filter((r) => etaOf(r) <= etaOf(chosen)) : []
  if (inTime.length) return [...inTime].sort((a, b) => a.amount - b.amount)[0]
  return [...rates].sort((a, b) => etaOf(a) - etaOf(b))[0]
}

/**
 * What booking the order's label needs, quoted now from the shop's pickup address to the
 * buyer's. Refused (400) when the order has no delivery to book or no courier takes the parcel.
 */
export async function labelBooking(scope: MedusaContainer, orderId: string): Promise<LabelBooking> {
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
  const rates = await quoteRates(scope, {
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
  })
  const rate = rateToBook(rates, chosen)
  if (!rate) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "No courier will collect this parcel right now. Try again later.")
  }
  return {
    rate: {
      request_token: rate.request_token,
      service_code: rate.service_code,
      courier_id: rate.courier_id,
      courier_name: rate.courier_name,
    },
    items: items.map((i) => ({ id: i.id, quantity: Number(i.quantity) })),
  }
}
