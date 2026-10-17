import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { ShipbubbleClient } from "./client"
import { ShipbubbleFulfillmentProviderService } from "./service"

export { isShipbubbleSignatureValid, ShipbubbleError, shipbubbleTime, shipbubbleTimeOf, shipbubbleToday, SHIPBUBBLE_TIMEZONE } from "./client"
export type { ShipbubbleCourier, ShipbubbleLabelRequest, ShipbubbleRateRequest } from "./client"
export { cancelledByShipbubble, SHIPBUBBLE_RATE } from "./service"
export type { ShipbubbleFulfillmentData, ShipbubbleMethodData, ShipbubbleQuote } from "./service"

/** Shipbubble's API outside the provider (validation and rates at checkout), configured like it in medusa-config. */
export function shipbubbleClient(): ShipbubbleClient {
  return new ShipbubbleClient(process.env.SHIPBUBBLE_API_KEY ?? "", process.env.SHIPBUBBLE_API_URL || undefined)
}

/** Medusa's id for the provider as medusa-config registers it (module provider `shipbubble`, id `shipbubble`). */
export const SHIPBUBBLE_PROVIDER_ID = "shipbubble_shipbubble"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [ShipbubbleFulfillmentProviderService],
})
