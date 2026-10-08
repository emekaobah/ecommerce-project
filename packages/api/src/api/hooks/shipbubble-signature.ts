import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { isShipbubbleSignatureValid } from "../../modules/shipbubble"

/**
 * Turns away a Shipbubble webhook whose `x-ship-signature` isn't the HMAC-SHA512 of its raw
 * body under our API key, so a forged shipment update moves no order.
 */
export function verifyShipbubbleSignature(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  const apiKey = process.env.SHIPBUBBLE_API_KEY ?? ""
  const rawBody = (req as MedusaRequest & { rawBody?: Buffer }).rawBody
  if (!rawBody || !isShipbubbleSignatureValid(apiKey, rawBody, req.headers["x-ship-signature"])) {
    res.status(401).json({ message: "Invalid Shipbubble signature" })
    return
  }
  next()
}
