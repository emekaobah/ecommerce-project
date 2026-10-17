import { createHmac, timingSafeEqual } from "node:crypto"
import { MedusaError } from "@medusajs/framework/utils"

export const SHIPBUBBLE_API_URL = "https://api.shipbubble.com/v1"
/** How long a call may take; label booking holds the order's lock through two of them. */
const REQUEST_TIMEOUT_MS = 30_000

/**
 * Shipbubble's timezone: it reads `pickup_date` and states every ETA as local time without an
 * offset (rates requested after 6pm GMT+1 are processed the next day).
 */
export const SHIPBUBBLE_TIMEZONE = "Africa/Lagos"
const SHIPBUBBLE_UTC_OFFSET = "+01:00"
const SHIPBUBBLE_UTC_OFFSET_MS = 60 * 60 * 1000

/** What Shipbubble needs to validate an address; coordinates win over the text when sent. */
export type ShipbubbleAddressInput = {
  name: string
  email: string
  phone: string
  address: string
  latitude?: number
  longitude?: number
}

export type ShipbubbleAddress = {
  address_code: number
  formatted_address: string
  state?: string | null
  city?: string | null
  latitude?: number | null
  longitude?: number | null
}

/** One parcel: weights in kg, dimensions in cm (Shipbubble's units). */
export type ShipbubbleRateRequest = {
  sender_address_code: number
  reciever_address_code: number
  /** yyyy-mm-dd */
  pickup_date: string
  category_id: number
  package_items: { name: string; description: string; unit_weight: string; unit_amount: string; quantity: string }[]
  package_dimension: { length: number; width: number; height: number }
  delivery_instructions?: string
}

/** A courier's rate as `fetch_rates` lists it (the fields we use). */
export type ShipbubbleCourier = {
  courier_id: string | number
  courier_name: string
  courier_image?: string | null
  service_code: string
  service_type?: string | null
  /** What the buyer is shown and pays, VAT included. */
  rate_card_amount: number
  currency: string
  delivery_eta?: string | null
  /** "yyyy-mm-dd HH:mm:ss", Lagos time. */
  delivery_eta_time: string
  pickup_eta_time?: string | null
  tracking_level?: number | null
}

export type ShipbubbleRates = { request_token: string; couriers: ShipbubbleCourier[] }

type Envelope<T> = { status: "success" | "failed"; message: string; data?: T; errors?: string[] }

/** A request Shipbubble refused; `status` is the HTTP status (422 for invalid values). */
export class ShipbubbleError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors: string[] = []
  ) {
    super(message)
  }

  /**
   * Shipbubble refused our account, not the request: a bad key, or an empty wallet, which it
   * answers with a 400 like a bad address. Ours to fix; never the buyer's.
   */
  get isAccountProblem() {
    return this.status === 401 || this.status === 403 || /wallet|balance|fund your/i.test(this.message)
  }
}

/** A package category Shipbubble's couriers quote for. Its id belongs to the account. */
export type ShipbubbleCategory = { category_id: number; category: string }

/** Shipbubble's "yyyy-mm-dd HH:mm:ss" Lagos time as ISO 8601 with its offset. */
export const shipbubbleTime = (local: string) => `${local.trim().replace(" ", "T")}${SHIPBUBBLE_UTC_OFFSET}`

/** An instant as Shipbubble states times (Lagos has no daylight saving), ISO 8601 with its offset. */
export const shipbubbleTimeOf = (instant: Date) =>
  shipbubbleTime(new Date(instant.getTime() + SHIPBUBBLE_UTC_OFFSET_MS).toISOString().slice(0, 19).replace("T", " "))

/** Today's date where Shipbubble works, for `pickup_date`. */
export const shipbubbleToday = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: SHIPBUBBLE_TIMEZONE }).format(now)

/** A courier rate to book a label with: a rate request's token and one courier it quoted. */
export type ShipbubbleLabelRequest = { request_token: string; service_code: string; courier_id: string }

/** A booked shipment as Shipbubble answers the booking (the fields we use). */
export type ShipbubbleShipment = {
  /** Shipbubble's id for the shipment, e.g. "SB-2CF48224272": its waybill number. */
  order_id: string
  status: string
  courier: { name: string }
  tracking_url: string
  waybill_document?: string | null
}

/**
 * Whether a webhook carries Shipbubble's signature: `x-ship-signature` is the HMAC-SHA512 of
 * the raw body keyed with our API key, in hex.
 */
export function isShipbubbleSignatureValid(
  apiKey: string,
  rawBody: Buffer | string,
  signature: string | string[] | undefined
): boolean {
  if (!apiKey || typeof signature !== "string") return false
  const expected = createHmac("sha512", apiKey).update(rawBody).digest()
  const received = Buffer.from(signature, "hex")
  return received.length === expected.length && timingSafeEqual(received, expected)
}

/** The Shipbubble calls we make: address validation, rates, and labels. */
export class ShipbubbleClient {
  constructor(
    private readonly apiKey: string,
    private readonly apiUrl = SHIPBUBBLE_API_URL
  ) {}

  /** Shipbubble's answer's `data`; `optional` for calls that answer with only a message. */
  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, optional = false): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${this.apiUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Couldn't reach Shipbubble: ${(error as Error).message}`)
    }
    const envelope = (await res.json().catch(() => null)) as Envelope<T> | null
    if (!res.ok || envelope?.status !== "success" || (envelope.data === undefined && !optional)) {
      throw new ShipbubbleError(res.status, envelope?.message ?? "No response from Shipbubble", envelope?.errors ?? [])
    }
    return envelope.data as T
  }

  validateAddress(input: ShipbubbleAddressInput) {
    return this.request<ShipbubbleAddress>("POST", "/shipping/address/validate", input)
  }

  fetchRates(input: ShipbubbleRateRequest) {
    return this.request<ShipbubbleRates>("POST", "/shipping/fetch_rates", input)
  }

  categories() {
    return this.request<ShipbubbleCategory[]>("GET", "/shipping/labels/categories")
  }

  /** Books a label with a quoted courier, paid from the account's wallet. */
  createLabel(input: ShipbubbleLabelRequest) {
    return this.request<ShipbubbleShipment>("POST", "/shipping/labels", input)
  }

  /** Cancels a shipment no courier has collected yet. */
  async cancelLabel(shipmentId: string): Promise<void> {
    await this.request<unknown>("POST", `/shipping/labels/cancel/${encodeURIComponent(shipmentId)}`, undefined, true)
  }
}
