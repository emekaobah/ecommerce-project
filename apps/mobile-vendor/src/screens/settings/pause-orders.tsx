import { Button, ErrorState, LoadingState, StatusChip, Text, useTheme, type StatusTone } from '@oja/ui';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { useMayManageShop } from '@/api/sellers';
import { usePauseShop, useResumeShop, useShopHours, type ShopHours } from '@/api/shop-hours';
import { Field } from '@/components/field';

const HOUR = 60 * 60 * 1000;

/** How long a pause lasts: until resumed, or a set time from now. */
const DURATIONS = [
  { label: 'Until I resume', hours: null },
  { label: '1 hour', hours: 1 },
  { label: '3 hours', hours: 3 },
] as const;

const tone = (status: NonNullable<ShopHours['status']>): StatusTone => {
  if (status.state === 'open') return 'success';
  return status.orderable ? 'warning' : 'danger';
};

/**
 * Before pausing, staff are told about orders still waiting to be accepted: a pause stops new
 * orders, not these, and their time to accept stands still until the shop reopens (ADR 0004).
 */
function confirmPause(newOrders: number, pause: () => void) {
  if (!newOrders) return pause();
  const orders = newOrders === 1 ? '1 new order is' : `${newOrders} new orders are`;
  Alert.alert(
    'Orders are waiting',
    `${orders} still waiting to be accepted. Pausing stops new orders, not these: accept or reject them. Their time to accept stands still while you're paused.`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Pause anyway', style: 'destructive', onPress: pause },
    ]
  );
}

/**
 * Pause / Resume orders (ADR 0004): closes the shop to new orders now, until resumed or for a
 * while, with a note buyers see. Every member sees whether the shop is paused; only owners and
 * managers get the controls.
 */
export function PauseOrders({ sellerId }: Readonly<{ sellerId: string }>) {
  const theme = useTheme();
  const hours = useShopHours(sellerId);
  const mayChange = useMayManageShop(sellerId);
  const pause = usePauseShop(sellerId);
  const resume = useResumeShop(sellerId);
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]>(DURATIONS[0]);
  const [note, setNote] = useState('');

  if (hours.error && !hours.data) {
    return <ErrorState title="Couldn't load your opening hours" message={hours.error.message} onRetry={() => void hours.refetch()} />;
  }
  if (!hours.data) return <LoadingState />;
  const { status, pause: current, new_orders: newOrders } = hours.data;

  const startPause = () =>
    confirmPause(newOrders, () =>
      pause.mutate(
        {
          until: duration.hours ? new Date(Date.now() + duration.hours * HOUR).toISOString() : null,
          note: note.trim() || null,
        },
        { onSuccess: () => setNote('') }
      )
    );
  const error = pause.error ?? resume.error;

  return (
    <View style={{ gap: theme.space.md }}>
      {status ? (
        <StatusChip label={status.label} tone={tone(status)} />
      ) : (
        <Text tone="danger">{"Set your weekly hours in the web vendor panel: buyers can't see your shop until you do."}</Text>
      )}
      {current ? (
        <Text tone="secondary">
          {current.ends_at
            ? `Orders are paused until ${new Date(current.ends_at).toLocaleString()}.`
            : 'Orders are paused until you resume them.'}
          {current.note ? ` Buyers see: "${current.note}"` : ''}
        </Text>
      ) : null}
      {mayChange.data && current ? (
        <Button label="Resume orders" loading={resume.isPending} onPress={() => resume.mutate()} />
      ) : null}
      {mayChange.data && !current ? (
        <View style={{ gap: theme.space.sm }}>
          <Text variant="label">Pause for</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
            {DURATIONS.map((option) => (
              <Button
                key={option.label}
                label={option.label}
                variant={option === duration ? 'primary' : 'secondary'}
                onPress={() => setDuration(option)}
              />
            ))}
          </View>
          <Field label="Note for buyers (optional)" value={note} maxLength={200} onChangeText={setNote} placeholder="e.g. Back after the power cut" />
          <Button label="Pause orders" variant="secondary" loading={pause.isPending} onPress={startPause} />
        </View>
      ) : null}
      {mayChange.data === false ? (
        <Text tone="secondary">{"Only the shop's owner or a manager can pause orders."}</Text>
      ) : null}
      {error ? <Text tone="danger">{error.message}</Text> : null}
    </View>
  );
}
