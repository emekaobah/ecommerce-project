import { takingOrdersLine } from '@oja/domain';
import { SwitchRow, useToast } from '@oja/ui';
import { useRouter } from 'expo-router';

import { useMayManageShop } from '@/api/sellers';
import { useResumeShop, useShopHours } from '@/api/shop-hours';
import { useNow } from '@/orders/use-now';

/**
 * "Taking orders" (ADR 0004): on while the shop isn't paused. Turning it off opens the pause
 * sheet (how long, a note for buyers); on again resumes at once. While paused it says until when
 * and what buyers read. Only owners and managers can change it; other staff see why not.
 */
export function TakingOrdersSetting({ sellerId }: Readonly<{ sellerId: string }>) {
  const router = useRouter();
  const toast = useToast();
  const hours = useShopHours(sellerId);
  const mayManage = useMayManageShop(sellerId);
  const resume = useResumeShop(sellerId);
  // Every half minute, so "until 3:47pm" turns into "until 3:47pm Tue" as the day goes by.
  const now = useNow();
  const pause = hours.data?.pause ?? null;

  return (
    <SwitchRow
      label="Taking orders"
      description={takingOrdersLine(hours.data ?? null, now)}
      value={!pause}
      disabled={!hours.data || mayManage.data !== true || resume.isPending}
      disabledReason={mayManage.data === false ? 'Only the owner or a manager can pause the shop' : undefined}
      onValueChange={(taking) => {
        if (!taking) {
          router.push('/pause-orders');
          return;
        }
        resume.mutate(undefined, {
          onError: () => toast({ message: "Couldn't turn orders back on. Check your connection and try again.", tone: 'problem' }),
        });
      }}
    />
  );
}
