import { Button, haptics, InlineNote, Sheet } from '@oja/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useFailureMessage } from '@/api/errors';
import { useConfirmHandover, useOrder } from '@/api/orders';

/**
 * One check before recording the staff half of a courier handover (catalogue v-hand #2): it
 * can't be undone, and the rider may not have arrived yet.
 */
export function HandOverSheet() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrder(id);
  const handOver = useConfirmHandover(id);
  const courier = order.data?.fulfilment.shipment?.courier_name ?? 'the courier';
  const failure = useFailureMessage(
    handOver.error,
    [400, 409],
    "Couldn't record the handover. Check your connection and try again; nothing has changed."
  );

  const confirm = () =>
    handOver.mutate(undefined, {
      onSuccess: () => {
        haptics.success();
        router.back();
      },
    });

  return (
    <Sheet
      title={`Handed the parcel to ${courier}?`}
      message="Only once the rider has taken the parcel."
      actions={
        <>
          {failure ? <InlineNote>{failure}</InlineNote> : null}
          <Button label="Yes, handed over" size="main" loading={handOver.isPending} onPress={confirm} />
          <Button label="Not yet" variant="secondary" disabled={handOver.isPending} onPress={() => router.back()} />
        </>
      }
    />
  );
}
