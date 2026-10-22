/** A letter or digit, in any script. */
const ALPHANUMERIC = /[\p{L}\p{N}]/gu

/**
 * The monogram a shop without a logo shows on the indigo pattern (#76): the first letter of its
 * first two words, or a one-word name's first two letters. Words with no letters ("&") are skipped.
 */
export function shopInitials(name: string): string {
  const words = name
    .split(/\s+/)
    .map((word) => word.match(ALPHANUMERIC) ?? [])
    .filter((letters) => letters.length > 0)
  const [first, second] = words
  if (!first) return ""
  const initials = second ? [first[0], second[0]] : first.slice(0, 2)
  return initials.join("").toLocaleUpperCase()
}
