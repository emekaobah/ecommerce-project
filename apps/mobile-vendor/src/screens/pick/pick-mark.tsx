import { StatusChip } from '@oja/ui';

type PickMarkProps = Readonly<{ picked: number; quantity: number; unavailable: number }>;

/**
 * A line's tick: done once picked in full, a count while part picked, empty before. Units
 * marked unavailable (#22) are shown until they are removed from the order.
 */
export function PickMark({ picked, quantity, unavailable }: PickMarkProps) {
  if (unavailable > 0) {
    const label = unavailable >= quantity ? 'Unavailable' : `${unavailable} unavailable`;
    return <StatusChip label={label} tone="danger" symbol="⊘" />;
  }
  if (picked >= quantity) return <StatusChip label="Picked" tone="success" />;
  if (picked > 0) return <StatusChip label={`${picked} of ${quantity}`} tone="warning" symbol="◐" />;
  return <StatusChip label="To pick" />;
}
