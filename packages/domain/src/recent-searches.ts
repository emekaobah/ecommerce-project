// The buyer's recent searches on the Search tab, kept on the phone only (#123).

/** How many recent searches the Search tab keeps. */
export const RECENT_SEARCHES_KEPT = 8

/**
 * The recent searches once `search` is used: newest first, a search made again moved to the
 * front rather than listed twice (whatever its case or spacing), and only the last few kept.
 */
export function rememberSearch(recent: readonly string[], search: string): string[] {
  const term = search.trim()
  if (!term) return [...recent]
  const same = term.toLocaleLowerCase()
  return [term, ...recent.filter((r) => r.trim().toLocaleLowerCase() !== same)].slice(0, RECENT_SEARCHES_KEPT)
}

/** What the buyer did to their recent searches: used one, or cleared them all. */
export type SearchChange = { type: "used"; search: string } | { type: "cleared" }

/**
 * The recent searches once `changes`, oldest first, are made to the `stored` ones: how searches
 * used before the phone's list was read join it rather than replace it.
 */
export function applySearchChanges(stored: readonly string[], changes: readonly SearchChange[]): string[] {
  return changes.reduce<string[]>(
    (recent, change) => (change.type === "used" ? rememberSearch(recent, change.search) : []),
    [...stored],
  )
}
