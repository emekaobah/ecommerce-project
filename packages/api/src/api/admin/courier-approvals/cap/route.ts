import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { setTopUpCap } from "../../../../lib/top-up-cap"
import type { AdminSetTopUpCapType } from "../validators"

export type AdminSetTopUpCapResponse = { top_up_cap: number }

/** Oja's team set the top-up cap (#19): what the platform pays above a buyer's checkout price for a shipment without approving it. */
export async function POST(req: AuthenticatedMedusaRequest<AdminSetTopUpCapType>, res: MedusaResponse<AdminSetTopUpCapResponse>) {
  res.json({ top_up_cap: await setTopUpCap(req.scope, req.validatedBody.top_up_cap) })
}
