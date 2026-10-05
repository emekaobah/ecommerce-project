import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { overrideProductPerishable, productPerishable, type ProductPerishable } from "../../../../../lib/perishable"
import type { AdminOverrideProductPerishableType } from "../../../perishable-validators"

export type AdminProductPerishableResponse = { perishable: ProductPerishable }

/** Whether a product is perishable, the operator's override if any, and what its categories make it. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse<AdminProductPerishableResponse>) {
  res.json({ perishable: await productPerishable(req.scope, req.params.id) })
}

/** Overrides whether the product is perishable, either way; null follows its categories again. */
export async function POST(
  req: AuthenticatedMedusaRequest<AdminOverrideProductPerishableType>,
  res: MedusaResponse<AdminProductPerishableResponse>
) {
  res.json({ perishable: await overrideProductPerishable(req.scope, req.params.id, req.validatedBody.override) })
}
