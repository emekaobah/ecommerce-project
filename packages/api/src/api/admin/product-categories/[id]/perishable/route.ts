import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { categoryPerishable, setCategoryPerishable, type CategoryPerishable } from "../../../../../lib/perishable"
import type { AdminSetCategoryPerishableType } from "../../../perishable-validators"

export type AdminCategoryPerishableResponse = { perishable: CategoryPerishable }

/** Whether the category is marked perishable, and whether a parent category makes it so anyway. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse<AdminCategoryPerishableResponse>) {
  res.json({ perishable: await categoryPerishable(req.scope, req.params.id) })
}

/** Marks the category perishable or not; its products and sub-categories' products follow it. */
export async function POST(
  req: AuthenticatedMedusaRequest<AdminSetCategoryPerishableType>,
  res: MedusaResponse<AdminCategoryPerishableResponse>
) {
  res.json({ perishable: await setCategoryPerishable(req.scope, req.params.id, req.validatedBody.perishable) })
}
