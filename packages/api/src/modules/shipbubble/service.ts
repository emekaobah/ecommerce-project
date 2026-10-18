import { AbstractFulfillmentProviderService, MedusaError } from "@medusajs/framework/utils"
import type { CalculatedShippingOptionPrice, CreateFulfillmentResult } from "@medusajs/framework/types"
import type { DeliveryChoice } from "@oja/domain"
import { ShipbubbleClient, ShipbubbleError, type ShipbubbleLabelRequest } from "./client"

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

/** Where label booking puts the courier rate to book, in the fulfilment's metadata. */
export const SHIPBUBBLE_RATE = "shipbubble_rate"

/** A Shipbubble fulfilment's data: the shipment booked for it. */
export type ShipbubbleFulfillmentData = {
  /** Shipbubble's id for the shipment ("SB-…"), its waybill number. */
  shipment_id: string
  courier_name: string | null
  tracking_url: string
  /** Shipbubble's status for it when booked, or `cancelled` once Shipbubble cancelled it. */
  status: string
}

/** A fulfilment's data once Shipbubble cancelled its shipment: cancelling the fulfilment then leaves Shipbubble alone. */
export const cancelledByShipbubble = (data: Record<string, unknown>) => ({ ...data, status: "cancelled" })

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
 * shipping-methods route is closed (`api/middlewares.ts`). Labels are booked on fulfilment (#24).
 */
export class ShipbubbleFulfillmentProviderService extends AbstractFulfillmentProviderService {
  static readonly identifier = "shipbubble"

  private readonly client: ShipbubbleClient

  constructor(_container: Record<string, unknown> = {}, options: ShipbubbleOptions = {}) {
    super()
    this.client = new ShipbubbleClient(options.apiKey ?? "", options.apiUrl)
  }

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

  /**
   * Books the courier label, paid from the platform's Shipbubble wallet (#24). Only label
   * booking (`bookLabelWorkflow`) creates Shipbubble fulfilments: its caller quotes the parcel afresh
   * and passes the courier rate to book in the fulfilment's `metadata.shipbubble_rate`. The
   * shipment's id is its waybill number, kept with the tracking link as the fulfilment's label.
   */
  async createFulfillment(
    _data: Record<string, unknown>,
    _items: unknown[],
    _order: unknown,
    fulfillment: { metadata?: Record<string, unknown> | null }
  ): Promise<CreateFulfillmentResult> {
    const rate = fulfillment.metadata?.[SHIPBUBBLE_RATE] as ShipbubbleLabelRequest | undefined
    if (!rate?.request_token) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Book the courier label from the order")
    }
    const shipment = await this.client
      .createLabel({ request_token: rate.request_token, service_code: rate.service_code, courier_id: rate.courier_id })
      .catch((error: unknown) => {
        if (!(error instanceof ShipbubbleError)) throw error
        // An empty wallet or a refused key is the platform's to fix; anything else, staff can retry.
        throw new MedusaError(
          error.isAccountProblem ? MedusaError.Types.UNEXPECTED_STATE : MedusaError.Types.NOT_ALLOWED,
          `Shipbubble couldn't book the label: ${error.message}`
        )
      })
    const data: ShipbubbleFulfillmentData = {
      shipment_id: shipment.order_id,
      courier_name: shipment.courier?.name ?? null,
      tracking_url: shipment.tracking_url,
      status: shipment.status,
    }
    return {
      data,
      labels: [
        {
          tracking_number: shipment.order_id,
          tracking_url: shipment.tracking_url,
          label_url: shipment.waybill_document || shipment.tracking_url,
        },
      ],
    }
  }

  /**
   * Cancels the shipment with Shipbubble, unless Shipbubble cancelled it itself (its webhook
   * marks the fulfilment's data first, `cancelledByShipbubble`).
   */
  async cancelFulfillment(data: Record<string, unknown>) {
    const { shipment_id, status } = data as Partial<ShipbubbleFulfillmentData>
    if (shipment_id && status !== cancelledByShipbubble({}).status) await this.client.cancelLabel(shipment_id)
    return {}
  }

  createReturnFulfillment(): Promise<CreateFulfillmentResult> {
    return Promise.resolve({ data: {}, labels: [] })
  }
}
