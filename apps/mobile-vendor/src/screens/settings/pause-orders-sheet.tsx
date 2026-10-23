import { pauseDurations, pauseWaitingMessage, type PauseDuration } from '@oja/domain';
import { Button, ConfirmSheet, InlineNote, RadioOption, Sheet, Skeleton, Text, TextField, useTheme } from '@oja/ui';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { useFailureMessage } from '@/api/errors';
import { usePauseShop, useShopHours } from '@/api/shop-hours';
import { shopHoursOf } from '@/orders/shop-state';
import { useSession } from '@/session/session-store';

/** What buyers read on a paused shop is at most this long (the API's limit). */
const NOTE_LENGTH = 200;

/**
 * Pause orders (ADR 0004, catalogue v-shop #5 and #6): how long, in plain words, and an optional
 * note buyers see on the shop. With orders still waiting to be accepted, a confirm follows,
 * since pausing doesn't stop their clocks.
 */
export function PauseOrdersSheet() {
  const theme = useTheme();
  const router = useRouter();
  const sellerId = useSession()?.sellerId;
  const shop = useShopHours(sellerId);
  const pause = usePauseShop(sellerId ?? '');
  const [now] = useState(() => new Date());
  const durations = useMemo(
    () => (shop.data ? pauseDurations(now, shopHoursOf(shop.data), shop.data.time_zone) : []),
    [shop.data, now],
  );
  const [chosen, setChosen] = useState<PauseDuration['key'] | null>(null);
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  // The catalogue starts on "until it next opens", when there is one.
  const selected = durations.find((d) => d.key === chosen) ?? durations.find((d) => d.key === 'next_opening') ?? durations[0];

  const startPause = () => {
    if (!selected) return;
    pause.mutate({ until: selected.until, note: note.trim() || null }, { onSuccess: () => router.back() });
  };
  const failed = useFailureMessage(
    pause.error,
    "Couldn't pause orders. Check your connection and try again; the shop is still taking orders.",
    { 403: 'Only the owner or a manager can pause the shop.' }
  );
  const failure = failed ? <InlineNote>{failed}</InlineNote> : null;

  const waiting = shop.data?.new_orders ?? 0;
  if (confirming) {
    return (
      <View>
        <ConfirmSheet
          title="Orders are waiting"
          message={pauseWaitingMessage(waiting)}
          confirmLabel="Pause anyway"
          destructive
          loading={pause.isPending}
          onConfirm={startPause}
          onCancel={() => setConfirming(false)}
        />
        {failure ? <View style={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[4] }}>{failure}</View> : null}
      </View>
    );
  }

  return (
    <Sheet
      title="Pause orders until…"
      actions={
        <>
          {failure}
          <Button
            label="Pause orders"
            size="main"
            disabled={!selected}
            loading={pause.isPending}
            onPress={() => (waiting > 0 ? setConfirming(true) : startPause())}
          />
        </>
      }>
      <View accessibilityRole="radiogroup" accessibilityLabel="Pause orders until" style={{ gap: theme.space[2] }}>
        {shop.data
          ? durations.map((duration) => (
              <RadioOption key={duration.key} selected={selected?.key === duration.key} onPress={() => setChosen(duration.key)}>
                <Text weight="semibold">{duration.label}</Text>
              </RadioOption>
            ))
          : [0, 1, 2].map((row) => <Skeleton key={row} height={theme.hitArea} radius="md" />)}
      </View>
      <TextField
        label="Note for buyers"
        optional
        testID="pause-note"
        maxLength={NOTE_LENGTH}
        value={note}
        onChangeText={setNote}
        placeholder="Back after the market run"
      />
    </Sheet>
  );
}
