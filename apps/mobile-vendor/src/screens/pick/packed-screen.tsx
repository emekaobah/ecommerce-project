import { buyerCourierQuote, dateLabel, parcelWeightLabel } from '@oja/domain';
import { Band, Button, ErrorState, Icon, LoadingState, RadioOption, StatusChip, Text, useTheme } from '@oja/ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOrder, type Order } from '@/api/orders';
import { useShopHours } from '@/api/shop-hours';
import { BookCourier } from '@/orders/courier-choice';
import { useSession } from '@/session/session-store';

/**
 * Packed (catalogue v-pick #6). A delivery order next needs its courier label: the courier and
 * date the buyer chose at checkout, the parcel as the catalogue weighs it, and Book courier label.
 * A pickup order is ready for its buyer to collect (#12), and its buyer is told.
 */
export function PackedScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrder(id);
  const timeZone = useShopHours(useSession()?.sellerId).data?.time_zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (order.error && !order.data) {
    return (
      <ErrorState
        title="Couldn't load the order"
        body="Check your connection and try again. The order is packed either way."
        error={order.error}
        onRetry={() => void order.refetch()}
      />
    );
  }
  if (!order.data) return <LoadingState />;
  const title = `Order #${order.data.display_id}`;

  if (order.data.fulfilment.method === 'pickup') {
    return (
      <Frame
        title={title}
        chip={<StatusChip label="Ready for pickup" tone="success" icon="store" onBand />}
        headline={`${title} is ready for pickup`}
        foot={<Button label="Back to orders" size="main" onPress={() => router.dismissTo('/')} />}>
        <Text tone="muted">{"Keep it at the counter. We've told the buyer; they collect it with the code in their app."}</Text>
      </Frame>
    );
  }

  return (
    <Frame
      title={title}
      chip={<StatusChip label="Packed" tone="info" icon="box" onBand />}
      headline="Packed. Book the courier."
      foot={<BookCourier orderId={id} currency={order.data.currency_code} onBooked={() => router.back()} />}>
      <BuyersCourier order={order.data} timeZone={timeZone} />
      <Parcel order={order.data} />
    </Frame>
  );
}

/** The indigo band (the state chip, the headline), the content, and the action at the foot, below it when it grows. */
function Frame({
  title,
  chip,
  headline,
  foot,
  children,
}: Readonly<{ title: string; chip: ReactNode; headline: string; foot: ReactNode; children: ReactNode }>) {
  const theme = useTheme();
  return (
    <>
      {/* Back returns to the order (the pick list was replaced by this screen). */}
      <Stack.Screen options={{ title, headerBackVisible: true }} />
      <ScrollView contentContainerStyle={styles.fill}>
        <Band style={{ gap: theme.space[2] }}>
          <View style={styles.end}>{chip}</View>
          <Text variant="titleNamed" tone="onBand">
            {headline}
          </Text>
        </Band>
        <View style={{ padding: theme.space[4], gap: theme.space[3] }}>{children}</View>
        <SafeAreaView edges={['bottom']} style={[styles.foot, { paddingHorizontal: theme.space[4], paddingTop: theme.space[2] }]}>
          <>{foot}</>
        </SafeAreaView>
      </ScrollView>
    </>
  );
}

/** The courier the buyer chose and paid for at checkout, and when it said it would arrive. Nothing without a quote. */
function BuyersCourier({ order, timeZone }: Readonly<{ order: Order; timeZone: string }>) {
  const quote = buyerCourierQuote(order);
  if (!quote) return null;
  return (
    <View accessibilityRole="radiogroup">
      <RadioOption
        selected
        onPress={() => {}}
        trailing={
          <Text variant="strong">Paid</Text>
        }>
        <Text weight="bold">{quote.courier_name}</Text>
        <Text variant="meta" tone="muted">
          {`Buyer chose it · arrives ${dateLabel(quote.delivery_eta_time, timeZone)} (quoted at checkout)`}
        </Text>
      </RadioOption>
    </View>
  );
}

/** "1 parcel · about 16 kg": the weights from the products, not editable here. */
function Parcel({ order }: Readonly<{ order: Order }>) {
  const theme = useTheme();
  const weight = parcelWeightLabel(order.items ?? []);
  return (
    <View accessible style={[styles.row, { gap: theme.space[3], paddingVertical: theme.space[2] }]}>
      <Icon name="box" color={theme.colors.ink} />
      <View style={styles.grow}>
        <Text weight="bold">{weight ? `1 parcel · ${weight}` : '1 parcel'}</Text>
        <Text variant="meta" tone="muted">
          {weight ? 'Weights from the products' : 'The products have no weights'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flexGrow: 1 },
  foot: { marginTop: 'auto' },
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  end: { alignSelf: 'flex-end' },
});
