import { openingLabel } from '@oja/domain';
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
  useNow();
  const pause = hours.data?.pause ?? null;

  const description = () => {
    if (!pause) return 'Turn off to pause the shop now';
    const until = pause.ends_at
      ? `Paused until ${openingLabel(pause.ends_at, new Date(), hours.data!.time_zone)}.`
      : 'Paused until you turn it back on.';
    return pause.note ? `${until} Buyers see: “${pause.note}”` : until;
  };

  return (
    <SwitchRow
      label="Taking orders"
      description={description()}
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
