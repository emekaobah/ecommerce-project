import { formatMoney } from '@oja/domain';
import { Button, ErrorState, LoadingState, Text, useTheme } from '@oja/ui';
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { cartKeys } from '@/api/cart';
import { useCheckout, useOrderGroup } from '@/api/checkout';
import { orderKeys } from '@/api/orders';
import { useCartSession, useIsAppCart } from '@/cart/cart-provider';

/** How long to wait for Paystack's webhook before telling the buyer it's taking a while. */
const CONFIRMATION_WAIT_MS = 60_000;

/**
 * After paying: waits for Paystack's webhook to confirm the payment, which turns the cart into
 * one order per shop, then shows them. Nothing counts as ordered before that.
 */
export function ConfirmationScreen() {
  const { cartId } = useLocalSearchParams<{ cartId: string }>();
  const checkout = useCheckout(cartId, { waitForOrder: true });
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

  const header = <Stack.Screen options={{ title: orderGroupId ? 'Order placed' : 'Confirming payment', headerBackVisible: false }} />;

  if (orderGroupId) {
    return (
      <>
        {header}
        <OrderPlaced orderGroupId={orderGroupId} />
      </>
    );
  }
  return (
    <>
      {header}
      {slow ? (
        <StillConfirming cartId={cartId} onCheckAgain={() => void checkout.refetch()} />
      ) : (
        <LoadingState label="Confirming your payment with Paystack" />
      )}
    </>
  );
}

/**
 * Paystack is slow to confirm, or the buyer didn't finish paying. Waiting stays the default:
 * paying again could charge twice if the first payment went through.
 */
function StillConfirming({ cartId, onCheckAgain }: Readonly<{ cartId: string; onCheckAgain: () => void }>) {
  const theme = useTheme();
  return (
    <View style={[styles.fill, styles.centered, { padding: theme.space[6], gap: theme.space[4] }]}>
      <Text variant="heading" style={styles.center}>
        Still confirming your payment
      </Text>
      <Text tone="muted" style={styles.center}>
        Paystack hasn&apos;t confirmed it yet. If you were charged, your order appears in Orders as soon as
        it&apos;s confirmed. If you didn&apos;t finish paying, go back to checkout and pay again.
      </Text>
      <Button label="Check again" onPress={onCheckAgain} />
      <Button label="Back to checkout" variant="secondary" onPress={() => router.dismissTo({ pathname: '/checkout', params: { cartId } })}
      />
    </View>
  );
}

function OrderPlaced({ orderGroupId }: Readonly<{ orderGroupId: string }>) {
  const theme = useTheme();
  const group = useOrderGroup(orderGroupId);
  const finish = (to: '/' | '/orders') => {
    router.dismissAll();
    router.navigate(to);
  };

  // The order is placed either way; its details are a nice-to-have.
  const details = () => {
    if (group.error && !group.data) {
      return (
        <ErrorState
          title="Couldn't load the order details"
          message={group.error.message}
          onRetry={() => void group.refetch()}
        />
      );
    }
    if (!group.data) return <LoadingState label="Loading your orders" />;
    return group.data.orders.map((order) => (
      <View
        key={order.id}
        style={{
          gap: theme.space[1],
          paddingTop: theme.space[4],
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.line,
        }}>
        <View style={styles.spread}>
          <Text variant="heading">{order.seller?.name ?? 'Shop'}</Text>
          <Text tone="muted">#{order.display_id}</Text>
        </View>
        {order.items.map((item) => (
          <Text key={item.id} tone="muted">
            {item.quantity} × {item.product_title}
          </Text>
        ))}
        <Text variant="strong">{formatMoney(order.total, order.currency_code)}</Text>
      </View>
    ));
  };

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.bg }]}>
      <ScrollView contentContainerStyle={{ padding: theme.space[4], gap: theme.space[6] }}>
        <View style={{ gap: theme.space[2] }}>
          <Text variant="displayLg">Thanks, your order is placed</Text>
          <Text tone="muted">
            Paystack confirmed your payment. Each shop prepares and delivers its own order.
          </Text>
        </View>
        {details()}
      </ScrollView>
      <View style={{ padding: theme.space[4], gap: theme.space[2] }}>
        <Button label="View orders" onPress={() => finish('/orders')} />
        <Button label="Keep shopping" variant="secondary" onPress={() => finish('/')} />
      </View>
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
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  centered: { justifyContent: 'center' },
  center: { textAlign: 'center' },
});
