type MembershipLike = { seller_id: string; seller?: { name?: string | null } | null }

export type ShopChoice<M> =
  | { kind: "none" }
  | { kind: "only"; sellerId: string }
  | { kind: "pick"; shops: M[] }

/**
 * Which shop a member acts for after signing in: the only one they belong to,
 * or a pick from several, listed by name.
 */
export function shopChoice<M extends MembershipLike>(memberships: readonly M[]): ShopChoice<M> {
  if (memberships.length === 0) return { kind: "none" }
  if (memberships.length === 1) return { kind: "only", sellerId: memberships[0]!.seller_id }
  const name = (m: M) => m.seller?.name ?? ""
  return { kind: "pick", shops: [...memberships].sort((a, b) => name(a).localeCompare(name(b))) }
}

/**
 * Whether a member can go on acting for the shop the app saved, or, once removed
 * from it, which shop they act for instead.
 */
export function currentShop<M extends MembershipLike>(
  memberships: readonly M[],
  savedSellerId: string
): { kind: "keep" } | ShopChoice<M> {
  if (memberships.some((m) => m.seller_id === savedSellerId)) return { kind: "keep" }
  return shopChoice(memberships)
}
