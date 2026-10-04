import { AbstractFulfillmentProviderService, MedusaError } from "@medusajs/framework/utils"
import type { CalculatedShippingOptionPrice, CreateFulfillmentResult } from "@medusajs/framework/types"
import type { DeliveryChoice } from "@oja/domain"

export type ShipbubbleOptions = {
  /** `sb_sandbox_…` or `sb_prod_…`. */
  apiKey?: string
  /** Shipbubble's API; overridden only to point tests at a fake. */
  apiUrl?: string
}

/** A courier rate for one shop's parcel, as checkout offers it. */
export type ShipbubbleQuote = {
  /** `service_code:courier_id`, unique within one rate request. */
  id: string
  request_token: string
  courier_id: string
  courier_name: string
  service_code: string
  /** What the buyer pays, VAT included, in the cart's currency. */
  amount: number
  currency: string
  /** Shipbubble's own wording, e.g. "Within 1 - 2 working days". */
  delivery_eta: string | null
  /** ISO 8601. */
  delivery_eta_time: string
  tracking_level: number | null
}

/**
 * Stored on a shop's shipping method: the rate the buyer chose, the choices they had, and what
 * they were quoted for (`basis`), so a cart changed since has its delivery quoted again.
 */
export type ShipbubbleMethodData = {
  quote: ShipbubbleQuote
  choices: DeliveryChoice<ShipbubbleQuote>[]
  basis: string
}

const isQuote = (value: unknown): value is ShipbubbleQuote =>
  !!value && typeof value === "object" && typeof (value as ShipbubbleQuote).amount === "number"

/** The buyer's chosen quote on a shipping method's data, or a rejection when checkout didn't put one there. */
const withQuote = <T>(data: Record<string, unknown>, then: (quote: ShipbubbleQuote) => T): Promise<T> =>
  isQuote(data.quote) && data.quote.amount > 0
    ? Promise.resolve(then(data.quote))
    : Promise.reject(new MedusaError(MedusaError.Types.INVALID_DATA, "Choose a delivery rate at checkout"))

/**
 * Shipbubble delivery (#23, docs/design.md). One calculated shipping option per shop; checkout
 * (`src/lib/delivery.ts`) asks Shipbubble for the shop's rates and adds the buyer's choice as
 * the method's data, which is the price. The data comes only from checkout: the store's own
 * shipping-methods route is closed (`api/middlewares.ts`). Labels are booked in #24.
 */
export class ShipbubbleFulfillmentProviderService extends AbstractFulfillmentProviderService {
  static readonly identifier = "shipbubble"

  static validateOptions(options: ShipbubbleOptions) {
    // Tests fake Shipbubble at the network boundary and set the key only where they do.
    if (!options.apiKey && process.env.NODE_ENV !== "test") {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Shipbubble delivery needs SHIPBUBBLE_API_KEY")
    }
  }

  getFulfillmentOptions() {
    return Promise.resolve([{ id: "shipbubble" }])
  }

  canCalculate() {
    return Promise.resolve(true)
  }

  validateOption() {
    return Promise.resolve(true)
  }

  validateFulfillmentData(_optionData: Record<string, unknown>, data: Record<string, unknown>) {
    return withQuote(data, () => data)
  }

  calculatePrice(_optionData: Record<string, unknown>, data: Record<string, unknown>): Promise<CalculatedShippingOptionPrice> {
    // Shipbubble's rate card amount includes VAT, like the shops' prices.
    return withQuote(data, (quote) => ({ calculated_amount: quote.amount, is_calculated_price_tax_inclusive: true }))
  }

  createFulfillment(): Promise<CreateFulfillmentResult> {
    // Booking the label with Shipbubble is #24.
    return Promise.resolve({ data: {}, labels: [] })
  }

  cancelFulfillment() {
    return Promise.resolve({})
  }

  createReturnFulfillment(): Promise<CreateFulfillmentResult> {
    return Promise.resolve({ data: {}, labels: [] })
  }
}
