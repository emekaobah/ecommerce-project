export type AddressPromptState = {
  /** The signed-in buyer; null for a guest or until Clerk has loaded. */
  userId: string | null
  /** The buyer's saved addresses: undefined while they load or when they won't load. */
  saved: readonly unknown[] | undefined
  /** The buyer who put the prompt off ("Enter it later") since the app started, if any. */
  dismissedBy: string | null
}

/**
 * Whether "Where should we deliver?" shows (#101): for a signed-in buyer with no saved address,
 * on every app start until they put it off for the session. The band and Home's empty state
 * reopen it by clearing `dismissedBy`.
 */
export function addressPromptShown({ userId, saved, dismissedBy }: AddressPromptState): boolean {
  return !!userId && saved?.length === 0 && dismissedBy !== userId
}
