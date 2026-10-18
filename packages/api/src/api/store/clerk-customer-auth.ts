import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { AuthIdentityDTO, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, generateJwtToken, MedusaError, Modules } from "@medusajs/framework/utils"
import { createCustomerAccountWorkflow } from "@medusajs/medusa/core-flows"
import { clerkProfileOf } from "../../modules/clerk-auth/service"

const PROVIDER = "clerk"
/** The Medusa token below only has to outlive the request it is minted for. */
const REQUEST_TOKEN_TTL_SECONDS = 60

type AuthedRequest = MedusaRequest & { auth_context?: Record<string, unknown> }

/**
 * Store requests from the buyer app carry the Clerk session token (ADR 0001). Medusa's store
 * routes only understand their own JWTs, so this verifies the Clerk token with the `clerk`
 * auth provider, finds or creates the customer, and swaps in a Medusa token for that customer
 * that lives only for this request. Every request is verified against Clerk's short-lived
 * token, so revoking a session in Clerk takes effect on the next request.
 *
 * A request with no bearer token is a guest and passes through; an invalid Clerk token is
 * rejected rather than silently downgraded to a guest.
 */
export async function clerkCustomerAuth(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  // Customers get no Medusa tokens (authMethodsPerActor), so any bearer here is Clerk's.
  if (!req.headers.authorization) return next()

  const auth = req.scope.resolve(Modules.AUTH)
  const { success, authIdentity, error } = await auth.authenticate(PROVIDER, {
    url: req.url,
    headers: req.headers as Record<string, string>,
    query: req.query as Record<string, string>,
    body: {},
    protocol: req.protocol,
  })
  if (!success || !authIdentity) {
    res.status(401).json({ message: error ?? "Unauthorized" })
    return
  }

  let customerId: string | undefined
  try {
    customerId = await customerFor(req.scope, authIdentity)
  } catch (error) {
    // The email belongs to another Clerk user's customer (e.g. a deleted and recreated Clerk account).
    if ((error as MedusaError).type === MedusaError.Types.DUPLICATE_ERROR) {
      res.status(409).json({ message: (error as Error).message })
      return
    }
    throw error
  }
  if (!customerId) {
    res.status(401).json({
      message: "The Clerk session token has no email claim. Add it to the session token template (see the API README).",
    })
    return
  }

  const { http } = req.scope.resolve(ContainerRegistrationKeys.CONFIG_MODULE).projectConfig
  const authContext = {
    actor_id: customerId,
    actor_type: "customer",
    auth_identity_id: authIdentity.id,
    auth_provider: PROVIDER,
    app_metadata: { customer_id: customerId },
    user_metadata: {},
  }
  const token = generateJwtToken(authContext, {
    secret: http.jwtSecret,
    expiresIn: REQUEST_TOKEN_TTL_SECONDS,
    jwtOptions: http.jwtOptions,
  })
  req.headers.authorization = `Bearer ${token}`
  ;(req as AuthedRequest).auth_context = authContext
  next()
}

/**
 * The auth identity's customer, created on first sign-in. Locked per identity so a new
 * buyer's first requests, which the app often sends together, create one customer.
 */
function customerFor(container: MedusaContainer, authIdentity: AuthIdentityDTO): Promise<string | undefined> {
  const existing = authIdentity.app_metadata?.customer_id as string | undefined
  if (existing) return Promise.resolve(existing)

  const { email, first_name, last_name } = clerkProfileOf(authIdentity)
  if (!email) return Promise.resolve(undefined)

  const locking = container.resolve(Modules.LOCKING)
  const auth = container.resolve(Modules.AUTH)
  return locking.execute(`clerk-customer:${authIdentity.id}`, async () => {
    const current = await auth.retrieveAuthIdentity(authIdentity.id)
    const created = current.app_metadata?.customer_id as string | undefined
    if (created) return created
    const { result } = await createCustomerAccountWorkflow(container).run({
      input: { authIdentityId: authIdentity.id, customerData: { email, first_name, last_name } },
    })
    return result.id
  })
}
