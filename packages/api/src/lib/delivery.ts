import { createHash } from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { MercurModules } from "@mercurjs/types"
import { arrivesByEndOfNextDay, deliveryChoices, deliveryStartsAt, etaCountedFrom, type DeliveryChoice } from "@oja/domain"
import {
  ShipbubbleError,
  SHIPBUBBLE_TIMEZONE,
  shipbubbleClient,
  shipbubbleTime,
  shipbubbleTimeOf,
  shipbubbleToday,
  type ShipbubbleQuote,
} from "../modules/shipbubble"
import { shopHoursOf } from "./shop-hours"

// Shipbubble delivery (#23, ADR 0002): validated addresses become Shipbubble address codes,
// stored in the address's `metadata.shipbubble_address_code`, and a shop's parcel to an address
// code is quoted by every courier Shipbubble has. The buyer picks from best value (preselected),
// the cheapest and the fastest (`deliveryChoices` in @oja/domain).

/** An address as Medusa stores it, with the pin and Shipbubble's code in `metadata`. */
export type DeliveryAddress = {
  first_name?: string | null
  last_name?: string | null
  address_1?: string | null
  address_2?: string | null
  city?: string | null
  province?: string | null
  country_code?: string | null
  phone?: string | null
  metadata?: Record<string, unknown> | null
}

/** One line of a shop's parcel: a variant and how many. */
export type ParcelLine = { variant_id: string; title: string; quantity: number; unit_price: number }

/**
 * Shipbubble's package category for the `package_category` products take from their category's
 * shipping defaults. Couriers quote only categories they carry. The ids belong to the Shipbubble
 * account, so they are looked up by name (GET /shipping/labels/categories) and kept.
 */
const PACKAGE_CATEGORIES: Record<string, string> = {
  groceries: "Groceries",
  fashion: "Fashion wears",
  electronics: "Electronics and gadgets",
}
const DEFAULT_PACKAGE_CATEGORY = "Light weight items"

let categoryIds: Promise<Map<string, number>> | undefined

/** The account's id for a package category, by its name; the default category's when it has none. */
async function packageCategoryId(category: string | null): Promise<number> {
  categoryIds ??= shipbubbleClient()
    .categories()
    .then((list) => new Map(list.map((c) => [c.category.trim().toLowerCase(), c.category_id])))
  const ids = await categoryIds.catch((error) => {
    categoryIds = undefined
    throw error
  })
  const name = (category && PACKAGE_CATEGORIES[category]) || DEFAULT_PACKAGE_CATEGORY
  const id = ids.get(name.toLowerCase()) ?? ids.get(DEFAULT_PACKAGE_CATEGORY.toLowerCase())
  if (id === undefined) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Shipbubble has no "${name}" package category`)
  }
  return id
}

/** When a product has no dimension of its own, cm. */
const DEFAULT_DIMENSION_CM = 10
/** When a product has no weight, grams. Publishing requires one (#33), so this is rare. */
const DEFAULT_WEIGHT_G = 1000

/** Where an address keeps the code Shipbubble validated it as, in its metadata (ADR 0002). */
export const ADDRESS_CODE = "shipbubble_address_code"

const numberOrNull = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null)

/** The Shipbubble address code stored on an address, if it has one. */
export function addressCodeOf(address: DeliveryAddress | null | undefined): number | null {
  const code = address?.metadata?.[ADDRESS_CODE]
  if (typeof code === "number") return code
  if (typeof code === "string" && /^\d+$/.test(code)) return Number(code)
  return null
}

/** The address as one line of text for Shipbubble: street to state, then the country's name. */
export function addressText(address: DeliveryAddress): string {
  const country = address.country_code
    ? new Intl.DisplayNames("en", { type: "region" }).of(address.country_code.toUpperCase())
    : null
  return [address.address_1, address.address_2, address.city, address.province, country]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ")
}

const pinOf = (address: DeliveryAddress) => {
  const latitude = numberOrNull(address.metadata?.latitude)
  const longitude = numberOrNull(address.metadata?.longitude)
  return latitude != null && longitude != null ? { latitude, longitude } : null
}

/** Whether two addresses are the same place to Shipbubble: the same pin, or with no pin the same text. */
export function samePlace(a: DeliveryAddress, b: DeliveryAddress): boolean {
  const [pinA, pinB] = [pinOf(a), pinOf(b)]
  if (pinA || pinB) return pinA?.latitude === pinB?.latitude && pinA?.longitude === pinB?.longitude
  return addressText(a) === addressText(b)
}

/**
 * Validates an address with Shipbubble, sending its pin's coordinates when it has one (which
 * Shipbubble then validates by) with the address text, and returns its address code.
 * An address Shipbubble can't place is refused (400).
 */
export async function validateAddress(address: DeliveryAddress, contact: { name: string; email: string }): Promise<number> {
  try {
    const validated = await shipbubbleClient().validateAddress({
      name: contact.name,
      email: contact.email,
      phone: address.phone ?? "",
      address: addressText(address),
      ...pinOf(address),
    })
    return validated.address_code
  } catch (error) {
    if (error instanceof ShipbubbleError && !error.isAccountProblem && (error.status === 400 || error.status === 422)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `We couldn't find this address for delivery. Check the street, area and state. (${error.message})`
      )
    }
    throw error
  }
}

/** The address with its Shipbubble code in metadata, validating it only when it has none. */
export async function withAddressCode<A extends DeliveryAddress>(
  address: A,
  contact: { name: string; email: string }
): Promise<A & { metadata: Record<string, unknown> }> {
  const code = addressCodeOf(address) ?? (await validateAddress(address, contact))
  return { ...address, metadata: { ...address.metadata, [ADDRESS_CODE]: code } }
}

type SellerRow = {
  id: string
  name: string
  email: string | null
  phone?: string | null
  address?: (DeliveryAddress & { id: string }) | null
}

async function loadSellerRow(scope: MedusaContainer, sellerId: string): Promise<SellerRow> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "seller",
    fields: ["id", "name", "email", "phone", "address.*"],
    filters: { id: sellerId },
  })
  const seller = data[0] as SellerRow | undefined
  if (!seller) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Seller ${sellerId} not found`)
  return seller
}

/** Validates a shop's address with Shipbubble, the shop as the contact; its phone when the address has none. */
const validateShopAddress = (seller: SellerRow, address: DeliveryAddress) =>
  validateAddress({ ...address, phone: address.phone ?? seller.phone ?? null }, { name: seller.name, email: seller.email ?? "" })

/** Why a pickup address without a pin is refused (ADR 0002, #41). */
export const PICKUP_PIN_NEEDED = "Place the pin on the map where couriers collect from the shop"

/** Whether an address has a whole pin in its metadata. */
export const hasPin = (address: DeliveryAddress | null | undefined) => !!address && pinOf(address) != null

/**
 * A change to the shop's pickup address, validated with Shipbubble before it is saved (by its
 * pin) and carrying the address code in its metadata: the onboarding gate's mark that couriers
 * can collect from it (#26). The address it leaves must have the pin its owner confirmed (#41),
 * and is what Shipbubble validated, so its code can be trusted later. An address without a pin,
 * or one Shipbubble can't place, is refused (400) and nothing is saved. Any code the change
 * itself carries is ignored.
 */
export async function validatedPickupChange<C extends DeliveryAddress>(
  scope: MedusaContainer,
  sellerId: string,
  change: C
): Promise<C & { metadata: Record<string, unknown> }> {
  const seller = await loadSellerRow(scope, sellerId)
  const current: DeliveryAddress = seller.address ?? {}
  // Fields the change leaves out keep their saved values; metadata it sends replaces the saved metadata.
  const defined = Object.fromEntries(Object.entries(change).filter(([, value]) => value !== undefined)) as DeliveryAddress
  const { [ADDRESS_CODE]: _ignored, ...metadata } = (change.metadata !== undefined ? change.metadata : current.metadata) ?? {}
  const address = { ...current, ...defined, metadata }
  if (!hasPin(address)) throw new MedusaError(MedusaError.Types.INVALID_DATA, PICKUP_PIN_NEEDED)
  const code = await validateShopAddress(seller, address)
  return { ...change, metadata: { ...metadata, [ADDRESS_CODE]: code } }
}

/**
 * The shop's pickup address's Shipbubble code: where couriers collect its parcels. Pickup
 * addresses are validated as they are saved; one saved without (e.g. at registration) is
 * validated the first time it is needed and the code kept on it.
 */
export async function senderAddressCode(scope: MedusaContainer, sellerId: string): Promise<number> {
  const seller = await loadSellerRow(scope, sellerId)
  const address = seller.address
  if (!address?.address_1) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `${seller.name} has no pickup address to deliver from yet`)
  }
  const known = addressCodeOf(address)
  if (known != null) return known

  const code = await validateShopAddress(seller, address)
  // The module's generated update; Mercur's types don't list the seller module's service.
  const sellers = scope.resolve(MercurModules.SELLER) as {
    updateSellerAddresses: (data: { id: string; metadata: Record<string, unknown> }) => Promise<unknown>
  }
  await sellers.updateSellerAddresses({ id: address.id, metadata: { ...address.metadata, [ADDRESS_CODE]: code } })
  return code
}

type VariantRow = {
  id: string
  weight?: number | string | null
  length?: number | string | null
  width?: number | string | null
  height?: number | string | null
  product?: {
    weight?: number | string | null
    length?: number | string | null
    width?: number | string | null
    height?: number | string | null
    metadata?: Record<string, unknown> | null
  } | null
}

const positive = (...values: unknown[]) => values.map(Number).find((v) => Number.isFinite(v) && v > 0)

/** A shop's parcel as Shipbubble quotes it: items in kg, one box in cm, and its package category. */
async function parcelOf(scope: MedusaContainer, lines: ParcelLine[]) {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_variant",
    fields: [
      "id",
      "weight",
      "length",
      "width",
      "height",
      "product.weight",
      "product.length",
      "product.width",
      "product.height",
      "product.metadata",
    ],
    filters: { id: lines.map((l) => l.variant_id) },
  })
  const variants = new Map((data as VariantRow[]).map((v) => [v.id, v]))
  const measured = lines.map((line) => {
    const v = variants.get(line.variant_id)
    const p = v?.product
    return {
      line,
      grams: positive(v?.weight, p?.weight) ?? DEFAULT_WEIGHT_G,
      length: positive(v?.length, p?.length) ?? DEFAULT_DIMENSION_CM,
      width: positive(v?.width, p?.width) ?? DEFAULT_DIMENSION_CM,
      height: positive(v?.height, p?.height) ?? DEFAULT_DIMENSION_CM,
      category: typeof p?.metadata?.package_category === "string" ? p.metadata.package_category : null,
    }
  })
  // The heaviest item decides the parcel's category.
  const heaviest = [...measured].sort((a, b) => b.grams * b.line.quantity - a.grams * a.line.quantity)[0]
  return {
    category_id: await packageCategoryId(heaviest?.category ?? null),
    package_items: measured.map(({ line, grams }) => ({
      name: line.title,
      description: line.title,
      unit_weight: String(grams / 1000),
      unit_amount: String(line.unit_price),
      quantity: String(line.quantity),
    })),
    // Items side by side on the largest footprint, stacked.
    package_dimension: {
      length: Math.max(...measured.map((m) => m.length)),
      width: Math.max(...measured.map((m) => m.width)),
      height: measured.reduce((sum, m) => sum + m.height * m.line.quantity, 0),
    },
  }
}

/**
 * What a quote was for: the receiver and what the shop sends. A shipping method whose basis no
 * longer matches the cart was quoted for a different parcel or address.
 */
export function quoteBasis(receiverCode: number | null, lines: Pick<ParcelLine, "variant_id" | "quantity">[]): string {
  const parcel = lines.map((l) => `${l.variant_id}:${l.quantity}`).sort((a, b) => a.localeCompare(b))
  return createHash("sha256").update(JSON.stringify([receiverCode, parcel])).digest("hex")
}

/** A product page's delivery estimate: the shop's best-value rate to the buyer's address. */
export type DeliveryEstimate = {
  courier_name: string
  amount: number
  delivery_eta: string | null
  /** ISO 8601. */
  delivery_eta_time: string
  /** Where days are counted for "Arrives tomorrow": the courier's (Shipbubble's) timezone. */
  time_zone: string
}

type CustomerRow = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  addresses?: (DeliveryAddress & { id: string; is_default_shipping?: boolean; created_at: string | Date })[] | null
}

/** The address a buyer's deliveries go to by default: their default shipping address, else their newest. */
async function deliveryAddressOf(scope: MedusaContainer, customerId: string) {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "customer",
    fields: ["id", "email", "first_name", "last_name", "addresses.*"],
    filters: { id: customerId },
  })
  const customer = data[0] as CustomerRow | undefined
  const addresses = [...(customer?.addresses ?? [])].sort(
    (a, b) =>
      Number(!!b.is_default_shipping) - Number(!!a.is_default_shipping) ||
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
  return customer && addresses[0] ? { customer, address: addresses[0] } : null
}

/**
 * How a shop would deliver one of a product to the buyer's saved address: its best-value rate,
 * for the product page (#23). Null for a guest, a buyer with no saved address, an address
 * Shipbubble can't place, or a parcel no courier takes (for a perishable product, none in time):
 * the page then shows the shop's dispatch time. A saved address validated here keeps its code.
 */
export async function estimateDelivery(
  scope: MedusaContainer,
  {
    customerId,
    sellerId,
    line,
    currencyCode,
    perishable,
    timeZone,
  }: {
    customerId: string | null | undefined
    sellerId: string
    line: ParcelLine
    currencyCode: string
    perishable: boolean
    timeZone: string
  }
): Promise<DeliveryEstimate | null> {
  if (!customerId) return null
  const saved = await deliveryAddressOf(scope, customerId)
  if (!saved) return null
  const { customer, address } = saved

  let receiverCode = addressCodeOf(address)
  if (receiverCode == null) {
    try {
      receiverCode = await validateAddress(address, {
        name: [address.first_name ?? customer.first_name, address.last_name ?? customer.last_name].filter(Boolean).join(" "),
        email: customer.email,
      })
    } catch (error) {
      if (error instanceof MedusaError && error.type === MedusaError.Types.INVALID_DATA) return null
      throw error
    }
    await scope
      .resolve(Modules.CUSTOMER)
      .updateCustomerAddresses(address.id, { metadata: { ...address.metadata, [ADDRESS_CODE]: receiverCode } })
  }

  const [best] = await quoteDelivery(scope, { sellerId, receiverCode, lines: [line], currencyCode, perishable, timeZone })
  return best
    ? {
        courier_name: best.courier_name,
        amount: best.amount,
        delivery_eta: best.delivery_eta,
        delivery_eta_time: best.delivery_eta_time,
        time_zone: SHIPBUBBLE_TIMEZONE,
      }
    : null
}

/**
 * Where a region counts its days (ADR 0004): its `metadata.time_zone`. A region without one
 * counts in Shipbubble's, the only courier network there is.
 */
export async function regionTimeZone(scope: MedusaContainer, regionId: string | null | undefined): Promise<string> {
  if (!regionId) return SHIPBUBBLE_TIMEZONE
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "region", fields: ["id", "metadata"], filters: { id: regionId } })
  const zone = (data[0] as { metadata?: Record<string, unknown> | null } | undefined)?.metadata?.time_zone
  return typeof zone === "string" && zone ? zone : SHIPBUBBLE_TIMEZONE
}

/**
 * The rates a parcel with perishable items may go by (#69): those arriving by the end of the
 * next day in the region's timezone. Other parcels go by any rate.
 */
export function ratesFor<R extends { delivery_eta_time: string }>(
  rates: R[],
  { perishable, timeZone, now = new Date() }: { perishable: boolean; timeZone: string; now?: Date }
): R[] {
  return perishable ? rates.filter((r) => arrivesByEndOfNextDay(r.delivery_eta_time, now, timeZone)) : rates
}

/**
 * A shop's delivery choices for a parcel to an address code: best value first, then the cheapest
 * and the fastest, of the rates it may go by (`ratesFor`). Empty when no courier will take it,
 * or, for perishables, none arrives in time.
 */
export async function quoteDelivery(
  scope: MedusaContainer,
  {
    perishable,
    timeZone,
    ...parcel
  }: { sellerId: string; receiverCode: number; lines: ParcelLine[]; currencyCode: string; perishable: boolean; timeZone: string }
): Promise<DeliveryChoice<ShipbubbleQuote>[]> {
  return deliveryChoices(ratesFor(await quoteRates(scope, parcel), { perishable, timeZone }))
}

/** When the shop's delivery estimates start (ADR 0004): now while it is open, else its next opening. */
async function deliveryStartOf(scope: MedusaContainer, sellerId: string, now: Date): Promise<Date> {
  const hours = (await shopHoursOf(scope, [sellerId], now)).get(sellerId) ?? null
  return deliveryStartsAt(hours, now)
}

/**
 * Every courier's rate for a shop's parcel to an address code. Empty when no courier will take
 * it. Delivery counts from the shop's next opening (ADR 0004): couriers are asked to collect on
 * the day it opens, and a courier whose collection slot (`pickup_eta_time`) comes before the
 * opening has its ETA moved later by the gap.
 */
export async function quoteRates(
  scope: MedusaContainer,
  { sellerId, receiverCode, lines, currencyCode }: { sellerId: string; receiverCode: number; lines: ParcelLine[]; currencyCode: string }
): Promise<ShipbubbleQuote[]> {
  const [senderCode, parcel, startsAt] = await Promise.all([
    senderAddressCode(scope, sellerId),
    parcelOf(scope, lines),
    deliveryStartOf(scope, sellerId, new Date()),
  ])
  let rates
  try {
    rates = await shipbubbleClient().fetchRates({
      sender_address_code: senderCode,
      reciever_address_code: receiverCode,
      pickup_date: shipbubbleToday(startsAt),
      ...parcel,
    })
  } catch (error) {
    // Shipbubble answers a parcel no courier carries between the two addresses with a 400 or
    // 422. Anything else, such as a refused API key, is ours to fix, not the buyer's.
    if (error instanceof ShipbubbleError && !error.isAccountProblem && (error.status === 400 || error.status === 422)) return []
    throw error
  }
  return rates.couriers
    .filter((c) => c.currency?.toLowerCase() === currencyCode.toLowerCase())
    .map((c) => ({
      id: `${c.service_code}:${c.courier_id}`,
      request_token: rates.request_token,
      courier_id: String(c.courier_id),
      courier_name: c.courier_name,
      service_code: c.service_code,
      amount: Number(c.rate_card_amount),
      currency: c.currency.toLowerCase(),
      delivery_eta: c.delivery_eta ?? null,
      delivery_eta_time: shipbubbleTimeOf(
        etaCountedFrom(shipbubbleTime(c.delivery_eta_time), c.pickup_eta_time ? shipbubbleTime(c.pickup_eta_time) : null, startsAt)
      ),
      tracking_level: c.tracking_level ?? null,
    }))
}
