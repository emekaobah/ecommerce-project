/** "1 item", "3 items", "2 sold-out items": a count of items, as orders, carts and buttons say it. */
export function itemsLabel(count: number, kind?: string): string {
  return [String(count), kind, count === 1 ? "item" : "items"].filter(Boolean).join(" ")
}
