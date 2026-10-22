import type { Knex } from "@medusajs/framework/mikro-orm/knex"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { deleteShippingOptionsWorkflow } from "@medusajs/medusa/core-flows"
import { createSellerShippingOptionsWorkflow } from "@mercurjs/core/workflows"
import {
  addressFormValues,
  addressFromForm,
  getAddressConfig,
  toE164,
  type AddressFieldKey,
  type Pin,
  type WeeklyHours,
} from "@oja/domain"
import { COLLECTION_POINT_MODULE, type CollectionPointModuleService } from "../modules/collection-point"
import { ORDER_FULFILMENT_MODULE, type OrderFulfilmentModuleService } from "../modules/order-fulfilment"
import { SHIPBUBBLE_PROVIDER_ID } from "../modules/shipbubble"
import { haversineKmSql } from "./sql"
import type { PickupAddressInput } from "./onboarding"
import { sellersWithHours, shopHoursOf } from "./shop-hours"

// A shop's collection point (#12, docs/design.md → Pickup): a shop that sets one offers its
// buyers in-store pickup at checkout. It is the shop's pickup address (followed as it changes)
// or a separate address, with instructions for buyers, and is open the shop's own hours.

type Scope = Pick<MedusaContainer, "resolve">

const service = (scope: Scope) => scope.resolve<CollectionPointModuleService>(COLLECTION_POINT_MODULE)

/** Medusa's fulfilment provider for the pickup shipping option: nothing is booked for a pickup. */
export const PICKUP_PROVIDER_ID = "manual_manual"
/** The shipping option type of a shop's pickup option. */
export const PICKUP_OPTION_TYPE = "pickup"
/**
 * Marks a shipping method as the shop's pickup on the cart and, once placed, on the order: how
 * an order's fulfilment method is known when it is placed (`methodOfShippingMethods`).
 */
export const PICKUP_METHOD_DATA = { pickup: true } as const

/** An address as buyers and staff read it: no pin. */
export type CollectionPointAddress = {
  address_1: string | null
  address_2: string | null
  city: string | null
  province: string | null
  postal_code: string | null
  country_code: string | null
  landmark: string | null
}

export type CollectionPointView = {
  follows_pickup_address: boolean
  address: CollectionPointAddress
  instructions: string
  phone: string | null
}

type StoredAddress = Partial<Record<"address_1" | "address_2" | "city" | "province" | "postal_code" | "country_code", string | null>> & {
  metadata?: Record<string, unknown> | null
}

type Row = {
  id: string
  seller_id: string
  follows_pickup_address: boolean
  address: StoredAddress | null
  instructions: string
  phone: string | null
}

const addressView = (address: StoredAddress | null | undefined): CollectionPointAddress => ({
  address_1: address?.address_1 ?? null,
  address_2: address?.address_2 ?? null,
  city: address?.city ?? null,
  province: address?.province ?? null,
  postal_code: address?.postal_code ?? null,
  country_code: address?.country_code ?? null,
  landmark: typeof address?.metadata?.landmark === "string" && address.metadata.landmark ? address.metadata.landmark : null,
})

/** Each shop's collection point, by seller; a shop without one doesn't offer pickup. */
export async function collectionPointsOf(scope: Scope, sellerIds: string[]): Promise<Map<string, CollectionPointView>> {
  const ids = [...new Set(sellerIds)]
  if (!ids.length) return new Map()
  const rows = (await service(scope).listCollectionPoints({ seller_id: ids })) as unknown as Row[]
  if (!rows.length) return new Map()
  const followers = rows.filter((r) => r.follows_pickup_address).map((r) => r.seller_id)
  const { data: sellers } = followers.length
    ? await scope
        .resolve(ContainerRegistrationKeys.QUERY)
        .graph({ entity: "seller", fields: ["id", "address.*"], filters: { id: followers } })
    : { data: [] }
  const pickupAddress = new Map(
    (sellers as unknown as { id: string; address?: StoredAddress | null }[]).map((s) => [s.id, s.address ?? null])
  )
  return new Map(
    rows.map((row) => [
      row.seller_id,
      {
        follows_pickup_address: row.follows_pickup_address,
        address: addressView(row.follows_pickup_address ? pickupAddress.get(row.seller_id) : row.address),
        instructions: row.instructions,
        phone: row.phone,
      },
    ])
  )
}

/** Where and when buyers collect from a shop: its collection point, open the shop's own hours (ADR 0004). */
export type CollectionPlace = CollectionPointView & { weekly: WeeklyHours | null; time_zone: string | null }

/** Each shop's collection point with its hours, by seller; a shop without one doesn't offer pickup. */
export async function collectionPlacesOf(scope: Scope, sellerIds: string[]): Promise<Map<string, CollectionPlace>> {
  const [points, hours] = await Promise.all([collectionPointsOf(scope, sellerIds), shopHoursOf(scope, sellerIds)])
  return new Map(
    [...points].map(([sellerId, point]) => {
      const shopHours = hours.get(sellerId)
      return [sellerId, { ...point, weekly: shopHours?.weekly ?? null, time_zone: shopHours?.time_zone ?? null }]
    })
  )
}

/**
 * Straight-line kilometres from `from` to each shop's collection point, unrounded: its own pin,
 * or the shop's pickup pin while it follows the pickup address. Shops without one, or without a
 * pin, are left out; none without a pin to measure from.
 */
export async function collectionPointDistancesKm(
  scope: Scope,
  sellerIds: string[],
  from: Pin | null | undefined
): Promise<Map<string, number>> {
  if (!from || !sellerIds.length) return new Map()
  const knex = scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION)
  const pinned = (axis: "latitude" | "longitude") =>
    `(CASE WHEN cp.follows_pickup_address THEN sp.${axis} ELSE (cp.address->'metadata'->>'${axis}')::double precision END)`
  const km = haversineKmSql(from, { latitude: pinned("latitude"), longitude: pinned("longitude") })
  const rows = (await knex("collection_point as cp")
    .leftJoin("shop_pin as sp", function () {
      this.on("sp.seller_id", "cp.seller_id").andOnNull("sp.deleted_at")
    })
    .select("cp.seller_id", knex.raw(`${km} AS km`))
    .whereNull("cp.deleted_at")
    .whereRaw("cp.seller_id = ANY(?)", [sellerIds])) as unknown as { seller_id: string; km: number | string | null }[]
  return new Map(rows.flatMap((r) => (r.km == null ? [] : [[r.seller_id, Number(r.km)] as const])))
}

/** What the vendor panel's form shows: the shop's collection point, and whether it may set one. */
export type VendorCollectionPoint = { collection_point: CollectionPointView | null; has_hours: boolean }

export async function vendorCollectionPoint(scope: Scope, sellerId: string): Promise<VendorCollectionPoint> {
  const [points, withHours] = await Promise.all([collectionPointsOf(scope, [sellerId]), sellersWithHours(scope, [sellerId])])
  return { collection_point: points.get(sellerId) ?? null, has_hours: withHours.has(sellerId) }
}

export type CollectionPointInput = {
  follows_pickup_address: boolean
  address?: PickupAddressInput | null
  instructions: string
  phone?: string | null
}

const COLLECTION_PIN_NEEDED = "Place the pin on the map where buyers collect"

/** Fields of the address form a collection point doesn't take: it names no person. */
const NOT_ASKED = new Set<string>(["first_name", "last_name", "phone"] satisfies AddressFieldKey[])

/**
 * A separate collection point's address, checked against its country's form and needing the pin
 * placed on the map (ADR 0002). Not validated with Shipbubble: no courier goes there.
 */
function separateAddress(form: PickupAddressInput | null | undefined): StoredAddress {
  if (!form) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Enter the collection point's address, or use the pickup address.")
  const country = form.country_code.toUpperCase()
  try {
    getAddressConfig(country)
  } catch {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `Addresses in ${country} can't be taken yet`)
  }
  const { latitude, longitude } = form.metadata ?? {}
  const pin = latitude != null && longitude != null ? { latitude, longitude } : null
  const values = addressFormValues(form, country)
  const result = pin ? addressFromForm(values, country, pin) : addressFromForm(values, country)
  const problems = result.ok
    ? []
    : Object.entries(result.errors).flatMap(([key, problem]) => (NOT_ASKED.has(key) ? [] : [problem]))
  if (!pin) problems.push(COLLECTION_PIN_NEEDED)
  if (problems.length) throw new MedusaError(MedusaError.Types.INVALID_DATA, `${problems.join(". ")}.`)
  const columns = Object.fromEntries(
    (["address_1", "address_2", "city", "province", "postal_code"] as const).map((key) => [key, form[key]?.trim() || null])
  )
  const landmark = form.metadata?.landmark?.trim()
  return {
    ...columns,
    country_code: country.toLowerCase(),
    metadata: { ...(landmark && { landmark }), latitude: pin!.latitude, longitude: pin!.longitude },
  }
}

/**
 * Sets the shop's collection point, so it offers pickup (owners and managers, #12). Only a shop
 * with opening hours may: buyers are told to come when it is open. Answers the vendor panel's form.
 */
export async function setCollectionPoint(scope: MedusaContainer, sellerId: string, input: CollectionPointInput): Promise<VendorCollectionPoint> {
  if (!(await sellersWithHours(scope, [sellerId])).has(sellerId)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Set the shop's opening hours before offering pickup: buyers collect when the shop is open.")
  }
  const address = input.follows_pickup_address ? null : separateAddress(input.address)
  const country = address?.country_code ?? (await pickupCountry(scope, sellerId))
  const phone = input.phone?.trim() ? toE164(input.phone, country.toUpperCase()) : null
  if (input.phone?.trim() && !phone) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Enter a valid phone number.")
  const row = {
    follows_pickup_address: input.follows_pickup_address,
    address,
    instructions: input.instructions.trim(),
    phone,
  }
  const [existing] = await service(scope).listCollectionPoints({ seller_id: sellerId })
  // Pickup goes on the cart as the shop's free shipping option, which the order then carries.
  await ensurePickupOption(scope, sellerId)
  if (existing) await service(scope).updateCollectionPoints({ id: existing.id, ...row })
  else await service(scope).createCollectionPoints({ seller_id: sellerId, ...row })
  return vendorCollectionPoint(scope, sellerId)
}

/** States a pickup order is still to be collected in. */
const OPEN_PICKUP_STATES = ["new", "accepted", "picking", "partially_available", "ready_for_pickup"]

/**
 * Stops the shop offering pickup (owners and managers, #12): its collection point and its pickup
 * shipping option go, so checkout no longer offers it, and a cart that had chosen it is delivered
 * again. Refused while one of its orders is still to be collected: its buyer needs to know where.
 */
export async function removeCollectionPoint(scope: MedusaContainer, sellerId: string): Promise<VendorCollectionPoint> {
  const open = await scope
    .resolve<OrderFulfilmentModuleService>(ORDER_FULFILMENT_MODULE)
    .listOrderFulfilments({ state: OPEN_PICKUP_STATES }, { select: ["order_id", "fulfilment"] })
  // The model keeps the fulfilment as untyped JSON.
  const pickupOrders = open.filter((r) => (r.fulfilment as { method?: string }).method === "pickup").map((r) => r.order_id)
  const { data: theirs } = pickupOrders.length
    ? await scope
        .resolve(ContainerRegistrationKeys.QUERY)
        .graph({ entity: "order_seller", fields: ["order_id"], filters: { order_id: pickupOrders, seller_id: sellerId } })
    : { data: [] }
  if (theirs.length) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Some pickup orders are still to collect here. Hand them over first.")
  }
  const options = (await sellerOptions(scope, [sellerId])).filter(isPickupOption).map((o) => o.id)
  if (options.length) await deleteShippingOptionsWorkflow(scope).run({ input: { ids: options } })
  const rows = await service(scope).listCollectionPoints({ seller_id: sellerId })
  if (rows.length) await service(scope).deleteCollectionPoints(rows.map((r) => r.id))
  return vendorCollectionPoint(scope, sellerId)
}

async function pickupCountry(scope: Scope, sellerId: string): Promise<string> {
  const { data } = await scope
    .resolve(ContainerRegistrationKeys.QUERY)
    .graph({ entity: "seller", fields: ["id", "address.country_code"], filters: { id: sellerId } })
  const country = (data[0] as { address?: { country_code?: string | null } | null } | undefined)?.address?.country_code
  if (!country) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Set the shop's pickup address first.")
  return country
}

type OptionRow = {
  id: string
  provider_id: string
  service_zone_id: string
  shipping_profile_id: string
  type?: { code?: string | null } | null
  seller?: { id: string; currency_code?: string | null } | null
  service_zone?: { fulfillment_set?: { location?: { id: string; fulfillment_providers?: ({ id: string } | null)[] | null } | null } | null } | null
}

async function sellerOptions(scope: Scope, sellerIds: string[]): Promise<OptionRow[]> {
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "shipping_option",
    fields: [
      "id",
      "provider_id",
      "service_zone_id",
      "shipping_profile_id",
      "type.code",
      "seller.id",
      "seller.currency_code",
      "service_zone.fulfillment_set.location.id",
      "service_zone.fulfillment_set.location.fulfillment_providers.id",
    ],
    filters: { provider_id: [SHIPBUBBLE_PROVIDER_ID, PICKUP_PROVIDER_ID] },
  })
  const wanted = new Set(sellerIds)
  return (data as unknown as OptionRow[]).filter((o) => o.seller && wanted.has(o.seller.id))
}

const isPickupOption = (o: OptionRow) => o.provider_id === PICKUP_PROVIDER_ID && o.type?.code === PICKUP_OPTION_TYPE

/** Each shop's pickup shipping option, by seller. */
export async function pickupOptionsBySeller(scope: Scope, sellerIds: string[]): Promise<Map<string, string>> {
  if (!sellerIds.length) return new Map()
  return new Map((await sellerOptions(scope, sellerIds)).filter(isPickupOption).map((o) => [o.seller!.id, o.id]))
}

/**
 * The shop's free pickup shipping option, made next to its courier delivery the first time it
 * sets a collection point: Mercur places an order per shop only for shops with a shipping method
 * on the cart.
 */
async function ensurePickupOption(scope: MedusaContainer, sellerId: string) {
  const options = await sellerOptions(scope, [sellerId])
  if (options.some(isPickupOption)) return
  const delivery = options.find((o) => o.provider_id === SHIPBUBBLE_PROVIDER_ID)
  const location = delivery?.service_zone?.fulfillment_set?.location
  if (!delivery || !location || !delivery.seller?.currency_code) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "The shop has no delivery set up to add pickup beside.")
  }
  if (!location.fulfillment_providers?.some((p) => p?.id === PICKUP_PROVIDER_ID)) {
    await scope.resolve(ContainerRegistrationKeys.LINK).create({
      [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
      [Modules.FULFILLMENT]: { fulfillment_provider_id: PICKUP_PROVIDER_ID },
    })
  }
  await createSellerShippingOptionsWorkflow(scope).run({
    input: {
      seller_id: sellerId,
      shipping_options: [
        {
          name: "Pickup",
          price_type: "flat",
          provider_id: PICKUP_PROVIDER_ID,
          service_zone_id: delivery.service_zone_id,
          shipping_profile_id: delivery.shipping_profile_id,
          prices: [{ currency_code: delivery.seller.currency_code, amount: 0 }],
          type: { label: "Pickup", description: "Collect in store.", code: PICKUP_OPTION_TYPE },
          rules: [
            { attribute: "enabled_in_store", value: "true", operator: "eq" },
            { attribute: "is_return", value: "false", operator: "eq" },
          ],
        },
      ],
    },
  })
}

/** Whether an order's (or cart's) shipping methods are its shop's pickup. */
export const isPickupMethod = (method: { data?: Record<string, unknown> | null } | null | undefined) =>
  method?.data?.pickup === true
