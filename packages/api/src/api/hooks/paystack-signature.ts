import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { isPaystackSignatureValid } from "../../modules/paystack"

/**
 * Turns away a Paystack webhook whose signature doesn't match before Medusa queues it, so a
 * forged `charge.success` gets a 401 rather than a silent 200. The provider checks again when
 * it handles the event.
 */
export function verifyPaystackSignature(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY
  const rawBody = (req as MedusaRequest & { rawBody?: Buffer }).rawBody
  if (!secretKey || !rawBody || !isPaystackSignatureValid(secretKey, rawBody, req.headers["x-paystack-signature"])) {
    res.status(401).json({ message: "Invalid Paystack signature" })
    return
  }
  next()
}
