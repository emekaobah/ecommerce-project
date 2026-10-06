import {
  acquireLockStep,
  deleteCustomerAddressesWorkflow,
  releaseLockStep,
  updateCustomerAddressesWorkflow,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows"
import { MedusaError } from "@medusajs/framework/utils"
import { WorkflowResponse, createWorkflow, transform, when } from "@medusajs/framework/workflows-sdk"
import { defaultAfterDeleting, type DefaultCandidate } from "@oja/domain"

export type DeleteSavedAddressInput = { customer_id: string; address_id: string }

/**
 * Deletes one of a buyer's saved addresses (#18). When it was their default and they have
 * others, the most recently added of the rest becomes the default, so checkout still starts
 * with one. The two happen together: if making the new default fails, the delete is undone.
 * Locked per buyer, so two deletes at once don't each promote an address the other removes.
 */
export const deleteSavedAddressWorkflow = createWorkflow("delete-saved-address", (input: DeleteSavedAddressInput) => {
  const lock = transform({ input }, ({ input }) => `saved-addresses:${input.customer_id}`)
  acquireLockStep({ key: lock, timeout: 5, ttl: 30 })

  const { data: addresses } = useQueryGraphStep({
    entity: "customer_address",
    fields: ["id", "is_default_shipping", "created_at"],
    filters: { customer_id: input.customer_id },
  })
  const promoted = transform({ input, addresses }, ({ input, addresses }) => {
    const saved = addresses as DefaultCandidate[]
    if (!saved.some((a) => a.id === input.address_id)) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Address with id: ${input.address_id} was not found`)
    }
    return defaultAfterDeleting(saved, input.address_id)
  })

  const ids = transform({ input }, ({ input }) => [input.address_id])
  deleteCustomerAddressesWorkflow.runAsStep({ input: { ids } })
  when({ promoted }, ({ promoted }) => !!promoted).then(() => {
    const promotion = transform({ input, promoted }, ({ input, promoted }) => ({
      selector: { id: promoted!, customer_id: input.customer_id },
      update: { is_default_shipping: true },
    }))
    updateCustomerAddressesWorkflow.runAsStep({ input: promotion })
  })

  releaseLockStep({ key: lock })
  return new WorkflowResponse(promoted)
})
