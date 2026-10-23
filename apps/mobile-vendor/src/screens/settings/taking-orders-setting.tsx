import { PauseOrders } from './pause-orders';

/** "Taking orders": whether the shop takes new orders now, and pausing or resuming them. */
export function TakingOrdersSetting({ sellerId }: Readonly<{ sellerId: string }>) {
  return <PauseOrders sellerId={sellerId} />;
}
