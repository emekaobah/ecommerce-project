import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { updateCustomerAddressesWorkflow } from "@medusajs/medusa/core-flows"
import { defaultAfterDeleting } from "@oja/domain"
import { ADDRESS_CODE, validateAddress, type DeliveryAddress } from "../../../lib/delivery"

// A saved delivery address (#18) is one the buyer checks out with, so Shipbubble validates it
// when it is saved, as checkout would (ADR 0002). Checkout still validates whatever address is
// set on the cart and never trusts a code from the request.

/** The fields Shipbubble validates an address by (with the buyer's email): who, where, and the pin. */
const DELIVERY_FIELDS = [
  "first_name",
  "last_name",
  "address_1",
  "address_2",
  "city",
  "province",
  "country_code",
  "phone",
  "metadata",
] as const

type AuthedRequest = MedusaRequest & { auth_context?: { actor_id?: string }; validatedBody?: unknown }
type AddressBody = DeliveryAddress & Record<string, unknown>
type SavedRow = DeliveryAddress & { id: string; is_default_shipping: boolean; created_at: string | Date }

/** The signed-in buyer's saved addresses; none for a guest, whom Medusa's route then refuses. */
async function savedAddressesOf(req: AuthedRequest): Promise<SavedRow[]> {
  const customerId = req.auth_context?.actor_id
  if (!customerId) return []
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "customer_address",
    fields: ["id", "is_default_shipping", "created_at", ...DELIVERY_FIELDS],
    filters: { customer_id: customerId },
  })
  return data as SavedRow[]
}

/**
 * Validates a new saved address, or an edit of one that changes where or to whom it delivers,
 * with Shipbubble, and puts Shipbubble's address code in the metadata Medusa then saves. A code
 * the app sent is dropped. An address Shipbubble can't place is refused (400) and nothing is
 * saved. Making an address the default changes no delivery field and asks Shipbubble nothing.
 * Runs after `savedAddressesNeedPins`, so an address that reaches it has its pin.
 */
export async function savedAddressesValidatedForDelivery(
  req: AuthedRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) {
  const customerId = req.auth_context?.actor_id
  // Medusa's route saves `validatedBody`, which its own validation (run before a project's
  // middlewares on the same route) built from `body`.
  const body = (req.validatedBody ?? req.body ?? {}) as AddressBody
  const addressId = req.params.address_id
  if (!customerId || (addressId && !DELIVERY_FIELDS.some((field) => body[field] !== undefined))) return next()

  // An edit is validated as it will be saved: the address with the edit merged in, metadata too.
  let address: DeliveryAddress = body
  if (addressId) {
    const saved = (await savedAddressesOf(req)).find((a) => a.id === addressId)
    // Not the buyer's: Medusa's route answers 404, and Shipbubble is never asked.
    if (!saved) return next()
    address = { ...saved, ...body, metadata: { ...saved.metadata, ...body.metadata } }
  }

  const customer = await req.scope.resolve(Modules.CUSTOMER).retrieveCustomer(customerId)
  const name = [address.first_name ?? customer.first_name, address.last_name ?? customer.last_name].filter(Boolean).join(" ")
  const code = await validateAddress(address, { name, email: customer.email })

  const { [ADDRESS_CODE]: _sent, ...metadata } = body.metadata ?? {}
  req.validatedBody = req.body = { ...body, metadata: { ...metadata, [ADDRESS_CODE]: code } }
  next()
}

/**
 * When the buyer deletes their default address and has others, the most recently added of the
 * rest becomes the default, so checkout still starts with one. It is promoted just before
 * Medusa's route deletes the address; one that isn't the buyer's changes nothing (404).
 */
export async function promoteDefaultOnDelete(req: AuthedRequest, _res: MedusaResponse, next: MedusaNextFunction) {
  const customerId = req.auth_context?.actor_id
  const promoted = defaultAfterDeleting(await savedAddressesOf(req), req.params.address_id)
  if (customerId && promoted) {
    await updateCustomerAddressesWorkflow(req.scope).run({
      input: { selector: { id: promoted, customer_id: customerId }, update: { is_default_shipping: true } },
    })
  }
  next()
}
