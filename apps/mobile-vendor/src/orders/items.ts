type Line = { product_title?: string | null; quantity: number | string };

/** "2 × Ofada Rice 5kg", one order line. */
export const lineLabel = (item: Line) => `${Number(item.quantity)} × ${item.product_title ?? 'Item'}`;

/** "2 × Ofada Rice 5kg · 1 × Rechargeable LED Lantern", for an order card. */
export function itemsSummary(items: Line[] | null | undefined) {
  return (items ?? []).map(lineLabel).join(' · ');
}
