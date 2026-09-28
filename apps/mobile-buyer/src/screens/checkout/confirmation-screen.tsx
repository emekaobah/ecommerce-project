import { formatMoney } from '@oja/domain';
import { Button, EmptyState, LoadingState, Text, useTheme } from '@oja/ui';
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { cartKeys } from '@/api/cart';
import { useCheckout, useOrderGroup } from '@/api/checkout';
import { useCartSession } from '@/cart/cart-provider';

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
  const slow = useElapsed(CONFIRMATION_WAIT_MS);
  const { forgetCart } = useCartSession();
  const queryClient = useQueryClient();

  // The cart is now orders: the next thing added starts a new one.
  useEffect(() => {
    if (!orderGroupId) return;
    forgetCart();
    void queryClient.invalidateQueries({ queryKey: cartKeys.all });
  }, [orderGroupId, forgetCart, queryClient]);

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
        <EmptyState
          title="Still confirming your payment"
          message="Paystack hasn't confirmed it yet. If you were charged, your order appears in Orders as soon as it's confirmed."
          action={{ label: 'Check again', onPress: () => void checkout.refetch() }}
        />
      ) : (
        <LoadingState label="Confirming your payment with Paystack" />
      )}
    </>
  );
}

function OrderPlaced({ orderGroupId }: Readonly<{ orderGroupId: string }>) {
  const theme = useTheme();
  const group = useOrderGroup(orderGroupId);
  const finish = (to: '/' | '/orders') => {
    router.dismissAll();
    router.navigate(to);
  };

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={{ padding: theme.space.md, gap: theme.space.lg }}>
        <View style={{ gap: theme.space.sm }}>
          <Text variant="title">Thanks, your order is placed</Text>
          <Text tone="secondary">
            Paystack confirmed your payment. Each shop prepares and delivers its own order.
          </Text>
        </View>
        {group.data
          ? group.data.orders.map((order) => (
                <View
                  key={order.id}
                  style={{
                    gap: theme.space.xs,
                    paddingTop: theme.space.md,
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: theme.colors.divider,
                  }}>
                  <View style={styles.spread}>
                    <Text variant="heading">{order.seller?.name ?? 'Shop'}</Text>
                    <Text tone="secondary">#{order.display_id}</Text>
                  </View>
                  {order.items.map((item) => (
                    <Text key={item.id} tone="secondary">
                      {item.quantity} × {item.product_title}
                    </Text>
                  ))}
                  <Text variant="label">{formatMoney(order.total, order.currency_code)}</Text>
                </View>
            ))
          : null}
        {group.error ? <Text tone="secondary">Couldn't load the order details: {group.error.message}</Text> : null}
      </ScrollView>
      <View style={{ padding: theme.space.md, gap: theme.space.sm }}>
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
});
