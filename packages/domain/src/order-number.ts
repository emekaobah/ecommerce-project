/**
 * A checkout's number as its buyer, its shops and Oja's support read it: "OJ-2410", from the
 * order group's `display_id`.
 */
export function orderNumber(displayId: number): string {
  return `OJ-${displayId}`
}
