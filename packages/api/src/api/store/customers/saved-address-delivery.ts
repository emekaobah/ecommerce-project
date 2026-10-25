import type { AuthenticatedMedusaRequest, MedusaNextFunction, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
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

/** Who Shipbubble validates a saved address for when neither it nor the account has a name. */
const STAND_IN_NAME = "Oja Buyer"

type AddressBody = DeliveryAddress & Record<string, unknown>

/** One of the buyer's saved addresses, or none when it isn't theirs. */
async function savedAddressOf(req: AuthenticatedMedusaRequest, customerId: string, addressId: string) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "customer_address",
    fields: ["id", ...DELIVERY_FIELDS],
    filters: { id: addressId, customer_id: customerId },
  })
  return data[0] as (DeliveryAddress & { id: string }) | undefined
}

/**
 * Validates a new saved address, or an edit of one that changes where or to whom it delivers,
 * with Shipbubble, and puts Shipbubble's address code in the metadata Medusa then saves. A code
 * the app sent is dropped. An address Shipbubble can't place is refused (400) and nothing is
 * saved. Making an address the default changes no delivery field and asks Shipbubble nothing.
 * Runs after `savedAddressesNeedPins`, so an address that reaches it has its pin.
 */
export async function savedAddressesValidatedForDelivery(
  req: AuthenticatedMedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) {
  try {
    await stampAddressCode(req)
    next()
  } catch (error) {
    next(error)
  }
}

async function stampAddressCode(req: AuthenticatedMedusaRequest) {
  // A guest has none; Medusa's route refuses them.
  const customerId = req.auth_context?.actor_id
  // Medusa's route saves `validatedBody`, which its own validation (run before a project's
  // middlewares on the same route) built from `body`; both are replaced, whichever runs first.
  const body = (req.validatedBody ?? req.body ?? {}) as AddressBody
  const addressId = req.params.address_id
  if (!customerId || (addressId && !DELIVERY_FIELDS.some((field) => body[field] !== undefined))) return

  // An edit is validated as it will be saved: the address with the edit merged in, metadata too.
  let address: DeliveryAddress = body
  if (addressId) {
    const saved = await savedAddressOf(req, customerId, addressId)
    // Not the buyer's: Medusa's route answers 404, and Shipbubble is never asked.
    if (!saved) return
    address = { ...saved, ...body, metadata: { ...saved.metadata, ...body.metadata } }
  }

  const customer = await req.scope.resolve(Modules.CUSTOMER).retrieveCustomer(customerId)
  // An address saves without a name (#101), and Shipbubble needs a full name with no numbers or
  // symbols: the account's stands in, else a fixed one. Checkout validates the cart's address
  // again in the receiver's name.
  const name =
    [address.first_name || customer.first_name, address.last_name || customer.last_name].filter(Boolean).join(" ") ||
    STAND_IN_NAME
  const code = await validateAddress(address, { name, email: customer.email })

  const { [ADDRESS_CODE]: _sent, ...metadata } = body.metadata ?? {}
  req.validatedBody = req.body = { ...body, metadata: { ...metadata, [ADDRESS_CODE]: code } }
}
