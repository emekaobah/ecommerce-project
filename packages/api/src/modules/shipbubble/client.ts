import { MedusaError } from "@medusajs/framework/utils"

export const SHIPBUBBLE_API_URL = "https://api.shipbubble.com/v1"

/**
 * Shipbubble's timezone: it reads `pickup_date` and states every ETA as local time without an
 * offset (rates requested after 6pm GMT+1 are processed the next day).
 */
export const SHIPBUBBLE_TIMEZONE = "Africa/Lagos"
const SHIPBUBBLE_UTC_OFFSET = "+01:00"

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
}

/** Shipbubble's "yyyy-mm-dd HH:mm:ss" Lagos time as ISO 8601 with its offset. */
export const shipbubbleTime = (local: string) => `${local.trim().replace(" ", "T")}${SHIPBUBBLE_UTC_OFFSET}`

/** Today's date where Shipbubble works, for `pickup_date`. */
export const shipbubbleToday = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: SHIPBUBBLE_TIMEZONE }).format(now)

/** The Shipbubble calls checkout needs: address validation and rates. */
export class ShipbubbleClient {
  constructor(
    private readonly apiKey: string,
    private readonly apiUrl = SHIPBUBBLE_API_URL
  ) {}

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${this.apiUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (error) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Couldn't reach Shipbubble: ${(error as Error).message}`)
    }
    const envelope = (await res.json().catch(() => null)) as Envelope<T> | null
    if (!res.ok || envelope?.status !== "success" || envelope.data === undefined) {
      throw new ShipbubbleError(res.status, envelope?.message ?? "No response from Shipbubble", envelope?.errors ?? [])
    }
    return envelope.data
  }

  validateAddress(input: ShipbubbleAddressInput) {
    return this.request<ShipbubbleAddress>("POST", "/shipping/address/validate", input)
  }

  fetchRates(input: ShipbubbleRateRequest) {
    return this.request<ShipbubbleRates>("POST", "/shipping/fetch_rates", input)
  }
}
