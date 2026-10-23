import { formatMoney } from '@oja/domain';
import { Button, Icon, InlineNote, LoadingState, PressableSurface, Text, useTheme } from '@oja/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { refusedWith } from '@/api/errors';
import { useMarkUnavailable, usePickList } from '@/api/orders';

import { LinePhoto } from './line-photo';

/**
 * Not available (catalogue v-pick #3, #22): a counter for how many of a line the shop can't
 * supply, from none up to the units not yet picked, with the refund the buyer gets for them
 * spelled out from the server's price per unit. They stay on the order until removed from it,
 * before packing, which is when the buyer is refunded.
 */
export function UnavailableSheet() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, item } = useLocalSearchParams<{ id: string; item: string }>();
  const pickList = usePickList(id);
  const line = pickList.data?.lines.find((l) => l.id === item);
  const mark = useMarkUnavailable(id);
  const [count, setCount] = useState<number | null>(null);

  if (!pickList.data || !line) return <LoadingState />;
  const most = line.quantity - line.picked;
  const quantity = count ?? Math.max(line.unavailable, 1);
  const refund = formatMoney(quantity * Number(line.unit_refund), pickList.data.currency_code);

  return (
    <View
      style={{
        backgroundColor: theme.colors.raised,
        paddingTop: theme.space[5],
        paddingHorizontal: theme.space[4],
        paddingBottom: Math.max(insets.bottom, theme.space[4]),
        gap: theme.space[4],
      }}>
      <View style={[styles.row, { gap: theme.space[3] }]}>
        <LinePhoto uri={line.thumbnail} />
        <View style={styles.grow}>
          <Text weight="bold">{line.product_title ?? 'Item'}</Text>
          <Text variant="meta" tone="muted">{`${line.quantity} ordered`}</Text>
        </View>
      </View>
      <Text variant="titlePushed">{"How many can't you supply?"}</Text>

      <View style={[styles.row, styles.centre, { gap: theme.space[6], paddingVertical: theme.space[2] }]}>
        <Step icon="minus" label="One fewer" disabled={quantity <= 0} onPress={() => setCount(Math.max(quantity - 1, 0))} />
        <Text
          variant="displayXxl"
          tabular
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${quantity} not available`}
          style={{ minWidth: theme.control.main, textAlign: 'center' }}>
          {quantity}
        </Text>
        <Step icon="plus" label="One more" disabled={quantity >= most} onPress={() => setCount(Math.min(quantity + 1, most))} />
      </View>

      {quantity > 0 ? (
        <InlineNote tone="info">
          {'The buyer is refunded '}
          <Text variant="meta" weight="extrabold" tone="muted">
            {refund}
          </Text>
          {` for ${quantity === 1 ? 'it' : 'them'} when you remove the unavailable items, before packing.`}
        </InlineNote>
      ) : null}
      {mark.error ? (
        <InlineNote>
          {refusedWith(mark.error, [400, 409]) ?? "Couldn't save that. Check your connection and try again."}
        </InlineNote>
      ) : null}
      <Button
        label={quantity === 0 ? 'Clear unavailable' : `Mark ${quantity} not available`}
        size="main"
        loading={mark.isPending}
        disabled={quantity === line.unavailable}
        onPress={() => mark.mutate({ itemId: line.id, quantity }, { onSuccess: () => router.back() })}
      />
    </View>
  );
}

/** A 48pt Mist round-rect with a minus or plus: the counter's steps. */
function Step({
  icon,
  label,
  disabled,
  onPress,
}: Readonly<{ icon: 'minus' | 'plus'; label: string; disabled: boolean; onPress: () => void }>) {
  const theme = useTheme();
  const size = theme.control.main;
  return (
    <PressableSurface
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.centre, { width: size, height: size, borderRadius: theme.radius.lg, backgroundColor: theme.colors.tile }]}>
      <Icon name={icon} use="step" color={disabled ? theme.colors.muted : theme.colors.ink} />
    </PressableSurface>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  centre: { alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
});
