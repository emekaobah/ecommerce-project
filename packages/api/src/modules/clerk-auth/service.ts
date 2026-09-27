import { verifyToken } from "@clerk/backend"
import { AbstractAuthModuleProvider, MedusaError } from "@medusajs/framework/utils"
import type {
  AuthenticationInput,
  AuthenticationResponse,
  AuthIdentityDTO,
  AuthIdentityProviderService,
} from "@medusajs/framework/types"

export type ClerkAuthOptions = {
  /** Secret key; used to fetch the instance's JWKS when no `jwtKey` is set. */
  secretKey?: string
  /** PEM public key from the Clerk dashboard, for networkless verification (recommended). */
  jwtKey?: string
  /**
   * Origins allowed in a token's `azp` claim. Tokens from the native apps carry no `azp`,
   * so this only narrows web clients.
   */
  authorizedParties?: string[]
}

/** Profile claims the buyer app's session token template adds (see the API README). */
export type ClerkProfile = { email?: string; first_name?: string; last_name?: string }

type SessionClaims = Record<string, unknown> & { sub?: string; sts?: string }

/** The profile stored on the Clerk provider identity, as of the last verified token. */
export function clerkProfileOf(authIdentity: AuthIdentityDTO): ClerkProfile {
  const identity = authIdentity.provider_identities?.find((p) => p.provider === ClerkAuthProviderService.identifier)
  return (identity?.user_metadata ?? {}) as ClerkProfile
}

function bearerToken(data: AuthenticationInput): string | undefined {
  const header = data.headers?.authorization
  return typeof header === "string" ? /^Bearer\s+(\S+)$/i.exec(header)?.[1] : undefined
}

function profileFrom(claims: Record<string, unknown>): ClerkProfile {
  const pick = (key: string) => (typeof claims[key] === "string" && claims[key] ? (claims[key] as string) : undefined)
  return { email: pick("email"), first_name: pick("first_name"), last_name: pick("last_name") }
}

/**
 * Medusa auth provider for Clerk session tokens. Clerk is the sole customer identity:
 * the token is verified and the Clerk user id (`sub`) becomes the auth identity's
 * entity id, so a changed email never splits one person into two customers.
 */
export class ClerkAuthProviderService extends AbstractAuthModuleProvider {
  static identifier = "clerk"
  static DISPLAY_NAME = "Clerk"

  private readonly options_: ClerkAuthOptions

  static validateOptions(options: ClerkAuthOptions) {
    if (!options.jwtKey && !options.secretKey) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "The Clerk auth provider needs CLERK_JWT_KEY (recommended) or CLERK_SECRET_KEY"
      )
    }
  }

  constructor(container: Record<string, unknown>, options: ClerkAuthOptions) {
    // @ts-ignore: the base constructor takes the container and options.
    super(...arguments)
    this.options_ = options
  }

  async authenticate(
    data: AuthenticationInput,
    authIdentityService: AuthIdentityProviderService
  ): Promise<AuthenticationResponse> {
    const token = bearerToken(data)
    if (!token) return { success: false, error: "Missing Clerk session token" }

    const { jwtKey, secretKey, authorizedParties } = this.options_
    let claims: SessionClaims
    try {
      // Checks signature, expiry and not-before (with Clerk's default clock skew) and `azp`.
      claims = (await verifyToken(token, { jwtKey, secretKey, authorizedParties })) as SessionClaims
    } catch {
      return { success: false, error: "Invalid Clerk session token" }
    }
    if (!claims.sub) return { success: false, error: "Invalid Clerk session token" }
    // A pending session still has tasks to finish in Clerk; it is not signed in yet.
    if (claims.sts === "pending") return { success: false, error: "Clerk session has pending tasks" }

    try {
      const authIdentity = await this.upsert_(claims.sub, profileFrom(claims), authIdentityService)
      return { success: true, authIdentity }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  /** Finds the Clerk user's auth identity, creating it on first sign-in and keeping its profile current. */
  private async upsert_(
    clerkUserId: string,
    profile: ClerkProfile,
    authIdentityService: AuthIdentityProviderService
  ): Promise<AuthIdentityDTO> {
    const find = () => authIdentityService.retrieve({ entity_id: clerkUserId })
    let existing: AuthIdentityDTO
    try {
      existing = await find()
    } catch (error) {
      if ((error as MedusaError).type !== MedusaError.Types.NOT_FOUND) throw error
      try {
        return await authIdentityService.create({ entity_id: clerkUserId, user_metadata: profile })
      } catch (createError) {
        // A concurrent first request for the same user may have created it first.
        existing = await find().catch(() => {
          throw createError
        })
      }
    }
    const stored = clerkProfileOf(existing)
    const changed = (Object.keys(profile) as (keyof ClerkProfile)[]).some((key) => stored[key] !== profile[key])
    return changed ? authIdentityService.update(clerkUserId, { user_metadata: profile }) : existing
  }

  /** Clerk owns sign-up; registering is the same as signing in. */
  async register(data: AuthenticationInput, authIdentityService: AuthIdentityProviderService) {
    return this.authenticate(data, authIdentityService)
  }
}
