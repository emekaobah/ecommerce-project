import { StatusChip } from '@oja/ui';

/** A line's tick: done once picked in full, a count while part picked, empty before. */
export function PickMark({ picked, quantity }: Readonly<{ picked: number; quantity: number }>) {
  if (picked >= quantity) return <StatusChip label="Picked" tone="success" />;
  if (picked > 0) return <StatusChip label={`${picked} of ${quantity}`} tone="warning" symbol="◐" />;
  return <StatusChip label="To pick" />;
}
