import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { deleteSavedAddressWorkflow } from "../../../../../../workflows/saved-addresses/delete-saved-address"

export { GET, POST } from "@medusajs/medusa/api/store/customers/me/addresses/[address_id]/route"

/**
 * Medusa's delete of a buyer's saved address, answered as Medusa answers it, except that
 * deleting the default makes the most recently added remaining address the default (#18).
 * GET and POST stay Medusa's own, re-exported so the typed route map (codegen reads this
 * file for the path) still has them.
 */
export const DELETE = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const customerId = req.auth_context.actor_id
  await deleteSavedAddressWorkflow(req.scope).run({ input: { customer_id: customerId, address_id: req.params.address_id } })

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "customer", fields: req.queryConfig.fields, filters: { id: customerId } })
  res.status(200).json({ id: customerId, object: "address", deleted: true, parent: data[0] })
}
