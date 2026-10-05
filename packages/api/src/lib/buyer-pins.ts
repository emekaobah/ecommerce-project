// Shop staff never get a buyer's coordinates (ADR 0002): the rider gets them from Shipbubble.
// Vendor routes answer whatever `fields` the shop asks for, so the pin is taken out of every
// buyer address in the response rather than out of the fields each route returns by default.

/** Where a buyer's address sits in a vendor response: an order's, or a customer's saved ones. */
const BUYER_ADDRESS_KEYS = new Set(["shipping_address", "billing_address", "addresses"])

type Address = { metadata?: Record<string, unknown> | null; [key: string]: unknown }

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object"

/** An object literal, as opposed to a class instance (a Date, Medusa's BigNumber) that serialises itself. */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!isObject(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function withoutPin(address: unknown): unknown {
  if (!isObject(address) || !isObject(address.metadata)) return address
  const { latitude: _latitude, longitude: _longitude, ...metadata } = (address as Address).metadata!
  return { ...address, metadata }
}

/** The response with the pin left out of every buyer address in it, however deep. */
export function withoutBuyerPins<T>(body: T): T {
  if (Array.isArray(body)) return body.map(withoutBuyerPins) as T
  if (!isPlainObject(body)) return body
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => {
      const inner = withoutBuyerPins(value)
      if (!BUYER_ADDRESS_KEYS.has(key)) return [key, inner]
      return [key, Array.isArray(inner) ? inner.map(withoutPin) : withoutPin(inner)]
    })
  ) as T
}
