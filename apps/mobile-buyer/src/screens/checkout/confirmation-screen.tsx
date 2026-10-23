import { useAuth, useUser } from '@clerk/expo';
import { deliveryEstimate, formatMoney, openingLabel, orderNumber } from '@oja/domain';
import { AdirePattern, ErrorState, Icon, Skeleton, StickyAction, Text, useTheme } from '@oja/ui';
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { cartKeys } from '@/api/cart';
import { useCheckout } from '@/api/checkout';
import { orderKeys, useOrderGroup, type OrderGroup, type SellerOrder } from '@/api/orders';
import { useCartSession, useIsAppCart } from '@/cart/cart-provider';
import { useDeliveringToId } from '@/delivering-to/delivering-to-provider';

/** How long to wait for Paystack's webhook before telling the buyer it's taking a while. */
const CONFIRMATION_WAIT_MS = 60_000;

/**
 * After paying: waits for Paystack's webhook to confirm the payment, which turns the cart into
 * one order per shop, then shows what happens next. Nothing counts as ordered before that.
 */
export function ConfirmationScreen() {
  const { cartId } = useLocalSearchParams<{ cartId: string }>();
  const checkout = useCheckout(cartId, { waitForOrder: true, addressId: useDeliveringToId() });
  const orderGroupId = checkout.data?.order_group_id;
  const notPlaced = !!checkout.data?.not_placed;
  const slow = useElapsed(CONFIRMATION_WAIT_MS);
  const { forgetCart } = useCartSession();
  const queryClient = useQueryClient();
  // A shop paid for on its own (#11) had a shop cart: the app's cart keeps the other shops.
  const paidAppCart = useIsAppCart(cartId);

  // Paid, but the cart didn't become orders and was refunded (#38): checkout says why, and what
  // changed in the cart, for the buyer to pay again.
  useEffect(() => {
    if (!notPlaced) return;
    void queryClient.invalidateQueries({ queryKey: cartKeys.all });
    router.dismissTo({ pathname: '/checkout', params: { cartId } });
  }, [notPlaced, cartId, queryClient]);

  // The cart is now orders: the next thing added starts a new one, and the order list shows them.
  useEffect(() => {
    if (!orderGroupId) return;
    if (paidAppCart) forgetCart();
    void queryClient.invalidateQueries({ queryKey: cartKeys.all });
    void queryClient.invalidateQueries({ queryKey: orderKeys.all });
  }, [orderGroupId, paidAppCart, forgetCart, queryClient]);

  if (orderGroupId) return <OrderPlaced orderGroupId={orderGroupId} email={checkout.data?.email ?? null} />;
  return (
    <>
      <Stack.Screen options={{ title: 'Order', headerBackVisible: false }} />
      {slow ? (
        <ErrorState
          icon="clock"
          title="Still confirming your payment"
          body="Paystack hasn't confirmed it yet. If you were charged, your order appears in Orders as soon as it's confirmed. If you didn't finish paying, go back to checkout and pay again."
          retryLabel="Check again"
          onRetry={() => void checkout.refetch()}
          secondaryAction={{ label: 'Back to checkout', onPress: () => router.dismissTo({ pathname: '/checkout', params: { cartId } }) }}
        />
      ) : (
        <Confirming />
      )}
    </>
  );
}

/** The one wait with a spinner, not a skeleton: there is no layout to preview, only a wait to explain. */
function Confirming() {
  const theme = useTheme();
  return (
    <View style={[styles.fill, styles.centred, { padding: theme.space[6], gap: theme.space[3], backgroundColor: theme.colors.bg }]}>
      <ActivityIndicator size="large" color={theme.colors.primary} accessibilityLabel="Confirming your payment with Paystack" />
      <Text variant="titleNamed" style={styles.centre}>
        Confirming your payment
      </Text>
      <Text tone="muted" style={styles.centre}>
        This usually takes a few seconds.
      </Text>
    </View>
  );
}

/** One step of what happens next: what, when in words, and the day. */
type NextStep = { key: string; title: string; detail: string; day: string | null; now: boolean };

const weekday = (at: string, timeZone: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone }).format(new Date(at));

/**
 * Each shop's part, in order: it accepts (now), prepares when it opens (a closed shop), then its
 * delivery arrives, as checkout quoted it, or the buyer collects it once it's ready.
 */
function nextSteps(orders: SellerOrder[], now: Date): NextStep[] {
  return orders.flatMap((order) => {
    const shop = order.seller.name;
    const steps: NextStep[] = [{ key: `${order.id}-accepts`, title: `${shop} accepts`, detail: 'Waiting for the shop', day: 'Today', now: true }];
    if (order.shop_opens) {
      const { at, time_zone } = order.shop_opens;
      steps.push({
        key: `${order.id}-opens`,
        title: `${shop} prepares your order`,
        detail: `When it opens, ${openingLabel(at, now, time_zone)}`,
        day: weekday(at, time_zone),
        now: false,
      });
    }
    if (order.delivery) {
      const { delivery_eta_time, time_zone } = order.delivery;
      steps.push({
        key: `${order.id}-arrives`,
        title: `${shop}'s order arrives`,
        detail: `${deliveryEstimate(delivery_eta_time, now, time_zone)}, by the courier you chose`,
        day: weekday(order.delivery.delivery_eta_time, order.delivery.time_zone),
        now: false,
      });
    } else if (order.pickup) {
      steps.push({
        key: `${order.id}-collect`,
        title: `Collect from ${shop}`,
        detail: "Once it's ready, your pickup code is in Orders",
        day: null,
        now: false,
      });
    }
    return steps;
  });
}

function OrderPlaced({ orderGroupId, email }: Readonly<{ orderGroupId: string; email: string | null }>) {
  const theme = useTheme();
  const { userId } = useAuth();
  const { user } = useUser();
  const group = useOrderGroup(userId, orderGroupId);
  const sentTo = email ?? user?.primaryEmailAddress?.emailAddress ?? null;
  const track = () => {
    router.dismissAll();
    router.push({ pathname: '/order/[id]', params: { id: orderGroupId } });
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: '',
          headerBackVisible: false,
          headerStyle: { backgroundColor: theme.colors.band },
          headerShadowVisible: false,
        }}
      />
      <ScrollView style={{ backgroundColor: theme.colors.raised }} contentContainerStyle={{ paddingBottom: theme.space[6] }}>
        <View style={[styles.hero, { backgroundColor: theme.colors.band, padding: theme.space[4], paddingBottom: theme.space[6], gap: theme.space[2] }]}>
          <AdirePattern opacity={0.5} />
          <View
            style={[
              styles.centred,
              { width: theme.shopMark.lg.size, height: theme.shopMark.lg.size, borderRadius: theme.radius.lg, backgroundColor: theme.colors.leaf },
            ]}>
            <Icon name="check" use="add" color={theme.colors.onPrimary} />
          </View>
          <Text variant="displayXl" tone="onBand" accessibilityLiveRegion="polite">
            Order placed
          </Text>
          <Text tone="onBand">{placedLine(group.data, sentTo)}</Text>
        </View>
        <Text variant="label" tone="muted" style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[4], paddingBottom: theme.space[2] }}>
          WHAT HAPPENS NEXT
        </Text>
        <View style={{ paddingHorizontal: theme.space[4] }}>
          {group.data ? (
            <NextSteps steps={nextSteps(group.data.orders, new Date())} />
          ) : group.error ? (
            // The order is placed either way: what happens next is in Orders too.
            <Text tone="muted">Each shop&apos;s progress shows in Orders.</Text>
          ) : (
            <View accessible accessibilityLabel="Loading what happens next" style={{ gap: theme.space[3] }}>
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} height={theme.control.md} radius="md" />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
      <StickyAction label="Track order" icon="fwd" onPress={track} />
    </>
  );
}

/** "Order OJ-2410 · ₦49,600 paid · confirmation sent to tolu@example.com" */
function placedLine(group: OrderGroup | undefined, sentTo: string | null): string {
  if (!group) return sentTo ? `Confirmation sent to ${sentTo}` : 'Paystack confirmed your payment';
  const currency = group.orders[0]?.currency_code ?? '';
  const paid = group.orders.reduce((sum, order) => sum + order.paid_total, 0);
  return [`Order ${orderNumber(group.display_id)}`, `${formatMoney(paid, currency)} paid`, sentTo ? `confirmation sent to ${sentTo}` : null]
    .filter(Boolean)
    .join(' · ');
}

/** What happens next, down a line: a leaf dot for what's happening now, grey for what's to come. */
function NextSteps({ steps }: Readonly<{ steps: NextStep[] }>) {
  const theme = useTheme();
  const dot = theme.icon.size.chip;
  return (
    <View>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <View
            key={step.key}
            accessible
            accessibilityLabel={[step.title, step.detail, step.day].filter(Boolean).join(', ')}
            style={[styles.row, { gap: theme.space[2] }]}>
            <View style={[styles.rail, { width: dot }]}>
              <View
                style={[
                  styles.centred,
                  { width: dot, height: dot, borderRadius: dot / 2, backgroundColor: step.now ? theme.colors.leaf : theme.colors.line },
                ]}>
                {step.now ? <View style={{ width: dot / 3, height: dot / 3, borderRadius: dot / 6, backgroundColor: theme.colors.onPrimary }} /> : null}
              </View>
              {last ? null : <View style={[styles.fill, { width: theme.line.input, backgroundColor: theme.colors.line }]} />}
            </View>
            <View style={[styles.fill, { paddingBottom: last ? 0 : theme.space[3] }]}>
              <Text weight="bold">{step.title}</Text>
              <Text variant="meta" tone="muted">
                {step.detail}
              </Text>
            </View>
            {step.day ? (
              <Text variant="meta" tone="muted">
                {step.day}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** True once `ms` have passed since the screen opened. */
function useElapsed(ms: number) {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setElapsed(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return elapsed;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centred: { alignItems: 'center', justifyContent: 'center' },
  centre: { textAlign: 'center' },
  hero: { overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  rail: { alignItems: 'center' },
});
