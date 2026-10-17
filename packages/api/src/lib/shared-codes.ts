import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

// A code on both a cart and its shop cart (#11, ADR 0010) counts one use: the first of the two
// paid registers it, and the other doesn't register it again. Each of the two carts keeps, in its
// metadata, the codes it shares with the other.

const SHARED_CODES_KEY = "shared_codes"

/** The codes a cart shares with each other cart, by that cart's id. */
export type SharedCodes = Record<string, string[]>

export function sharedCodesOf(metadata: Record<string, unknown> | null | undefined): SharedCodes {
  const stored = metadata?.[SHARED_CODES_KEY]
  if (!stored || typeof stored !== "object") return {}
  return Object.fromEntries(
    Object.entries(stored).filter(
      (entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every((c) => typeof c === "string")
    )
  )
}

/** The cart's metadata sharing `codes` with another cart; no codes shares none. */
export function withSharedCodes(
  metadata: Record<string, unknown> | null | undefined,
  otherCartId: string,
  codes: string[]
): Record<string, unknown> {
  const { [otherCartId]: _previous, ...others } = sharedCodesOf(metadata)
  return { ...metadata, [SHARED_CODES_KEY]: codes.length ? { ...others, [otherCartId]: codes } : others }
}

/**
 * The codes the cart shares whose one use is already counted: a cart sharing the code was paid
 * with it on. Such a code is still the cart's to use, and paying for it registers no second use.
 */
export async function codesCountedElsewhere(scope: MedusaContainer, cartId: string): Promise<string[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: carts } = await query.graph({ entity: "cart", fields: ["metadata"], filters: { id: cartId } })
  const shared = sharedCodesOf((carts[0] as { metadata?: Record<string, unknown> | null } | undefined)?.metadata)
  const otherIds = Object.keys(shared)
  if (!otherIds.length) return []
  const { data } = await query.graph({
    entity: "cart",
    fields: ["id", "completed_at", "promotions.code"],
    filters: { id: otherIds },
  })
  type Other = { id: string; completed_at: string | Date | null; promotions?: { code: string | null }[] | null }
  const counted = (data as unknown as Other[])
    .filter((other) => other.completed_at)
    .flatMap((other) => {
      const paidWith = new Set((other.promotions ?? []).map((p) => p.code))
      return shared[other.id].filter((code) => paidWith.has(code))
    })
  return [...new Set(counted)]
}
