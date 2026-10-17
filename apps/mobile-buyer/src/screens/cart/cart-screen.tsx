import { useAuth } from '@clerk/expo';
import { formatMoney } from '@oja/domain';
import { Button, EmptyState, ErrorState, LoadingState, Text, useTheme } from '@oja/ui';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCart, usePayShopOnly, useSetCartItemQuantity, type Cart, type CartItem } from '@/api/cart';
import { isNotFound } from '@/api/errors';
import { useCartSession } from '@/cart/cart-provider';
import { PerishableChip, PerishableRule } from '@/components/perishable';
import { Price } from '@/components/price';
import { ShopStatusBadge } from '@/components/shop-status';

/** The cart, one section per shop: each shop ships, and becomes an order, on its own. */
export function CartScreen() {
  const theme = useTheme();
  const { cartId, forgetCart } = useCartSession();
  const cart = useCart(cartId);
  const cartMissing = isNotFound(cart.error);

  useEffect(() => {
    if (cartMissing) forgetCart();
  }, [cartMissing, forgetCart]);

  const content = () => {
    if (cartId === null || cartMissing || cart.data?.item_count === 0) {
      return (
        <EmptyState
          title="Your cart is empty"
          message="Add something from a shop and it will show up here."
          action={{ label: 'Start shopping', onPress: () => router.navigate('/') }}
        />
      );
    }
    // A failed refresh keeps the cart already on screen.
    if (cart.error && !cart.data) {
      return (
        <ErrorState title="Couldn't load your cart" message={cart.error.message} onRetry={() => void cart.refetch()} />
      );
    }
    if (!cartId || !cart.data) return <LoadingState />;
    return <CartContents cartId={cartId} cart={cart.data} />;
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text variant="title" style={{ marginVertical: theme.space.md, paddingHorizontal: theme.space.md }}>
        Cart
      </Text>
      {content()}
    </SafeAreaView>
  );
}

function CartContents({ cartId, cart }: Readonly<{ cartId: string; cart: Cart }>) {
  const theme = useTheme();
  const { isSignedIn } = useAuth();
  // The floating tab bar overlays the screen; its height is in the bottom inset.
  const { bottom } = useSafeAreaInsets();
  const setQuantity = useSetCartItemQuantity(cartId);
  const payShopOnly = usePayShopOnly(cartId);
  const pendingItemId = setQuantity.isPending ? setQuantity.variables?.itemId : undefined;
  const currency = cart.currency_code;
  const sections = cart.sellers.map((group) => ({ key: group.seller?.id ?? 'unavailable', group, data: group.items }));
  // Checkout is protected; a guest goes through the sign-in modal first (ADR 0001).
  const checkout = () => router.push(isSignedIn ? '/checkout' : '/sign-in');
  // With several shops in the cart, one shop's items can be paid for on their own (#11): they
  // move to a cart of their own, checked out like any other; the rest stays in this cart.
  const paysShopByShop = cart.sellers.length > 1;
  const checkoutShop = (sellerId: string) => {
    if (!isSignedIn) {
      router.push('/sign-in');
      return;
    }
    payShopOnly.mutate(sellerId, {
      onSuccess: (shopCart) => router.push({ pathname: '/checkout', params: { cartId: shopCart.id } }),
    });
  };

  return (
    <>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: theme.space.md, paddingBottom: theme.space.lg }}
        renderSectionHeader={({ section: { group } }) => (
          <View style={{ paddingTop: theme.space.lg, paddingBottom: theme.space.sm, gap: theme.space.xs }}>
            <Text variant="heading">{group.seller?.name ?? 'No longer available'}</Text>
            {group.seller ? null : (
              <Text tone="secondary">These shops stopped selling these items. Remove them to check out.</Text>
            )}
            {group.shop_status ? <ShopStatusBadge status={group.shop_status} withNote /> : null}
            {group.seller && group.perishable ? <PerishableRule /> : null}
          </View>
        )}
        renderItem={({ item, section: { group } }) => (
          <CartRow
            item={item}
            available={!!group.seller}
            currencyCode={currency}
            busy={pendingItemId === item.id}
            onChange={(quantity) => setQuantity.mutate({ itemId: item.id, quantity })}
          />
        )}
        renderSectionFooter={({ section: { group } }) => (
          <View style={{ paddingVertical: theme.space.sm, gap: theme.space.sm }}>
            <View style={styles.spread}>
              <Text tone="secondary">{group.seller ? `${group.seller.name} subtotal` : 'Subtotal'}</Text>
              <Text variant="label">{formatMoney(group.item_subtotal, currency)}</Text>
            </View>
            {paysShopByShop && group.seller ? (
              <Button
                label="Pay for this shop only"
                variant="secondary"
                loading={payShopOnly.isPending && payShopOnly.variables === group.seller.id}
                disabled={payShopOnly.isPending || !group.shop_status?.orderable}
                onPress={() => checkoutShop(group.seller!.id)}
              />
            ) : null}
          </View>
        )}
      />
      <View
        style={{
          padding: theme.space.md,
          paddingBottom: theme.space.md + bottom,
          gap: theme.space.sm,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.divider,
        }}>
        {setQuantity.error ? (
          <Text tone="secondary" accessibilityLiveRegion="polite">
            Couldn't update your cart: {setQuantity.error.message}
          </Text>
        ) : null}
        {payShopOnly.error ? (
          <Text tone="secondary" accessibilityLiveRegion="polite">
            Couldn&apos;t check out that shop on its own: {payShopOnly.error.message}
          </Text>
        ) : null}
        <Text tone="secondary">Delivery is chosen for each shop at checkout.</Text>
        <Button label="Checkout" detail={formatMoney(cart.item_subtotal, currency)} onPress={checkout} />
      </View>
    </>
  );
}

function CartRow({
  item,
  available,
  currencyCode,
  busy,
  onChange,
}: Readonly<{
  item: CartItem;
  /** False once the shop stopped selling it: it can only be removed. */
  available: boolean;
  currencyCode: string;
  busy: boolean;
  onChange: (quantity: number) => void;
}>) {
  const theme = useTheme();
  const title = item.product_title ?? 'Item';
  const variant = item.variant_title && item.variant_title !== 'Default' ? item.variant_title : null;
  return (
    <View
      style={[
        styles.row,
        {
          gap: theme.space.md,
          paddingVertical: theme.space.sm,
          borderBottomColor: theme.colors.divider,
          opacity: busy ? 0.6 : 1,
        },
      ]}>
      <Image
        source={item.thumbnail}
        contentFit="contain"
        style={[styles.thumb, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm }]}
      />
      <View style={[styles.details, { gap: theme.space.xs }]}>
        <Text numberOfLines={2}>{title}</Text>
        {variant ? <Text variant="caption" tone="secondary">{variant}</Text> : null}
        {item.perishable ? <PerishableChip /> : null}
        <Price price={{ amount: item.unit_price, compareAt: item.compare_at_unit_price }} currencyCode={currencyCode} />
        {item.discounts.map((discount) => (
          <Text key={discount.code} variant="caption" tone="secondary">
            {`${discount.code} −${formatMoney(discount.amount, currencyCode)}`}
          </Text>
        ))}
        {available ? (
          <Stepper title={title} quantity={item.quantity} disabled={busy} onChange={onChange} />
        ) : (
          <Button
            label="Remove"
            variant="link"
            disabled={busy}
            onPress={() => onChange(0)}
            style={styles.removeOnly}
          />
        )}
      </View>
    </View>
  );
}

function Stepper({
  title,
  quantity,
  disabled,
  onChange,
}: Readonly<{ title: string; quantity: number; disabled: boolean; onChange: (quantity: number) => void }>) {
  const theme = useTheme();
  const control = (label: string, symbol: string, next: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onChange(next)}
      style={({ pressed }) => [
        styles.stepperButton,
        { width: theme.touchTarget, height: theme.touchTarget },
        pressed && styles.pressed,
      ]}>
      <Text variant="label">{symbol}</Text>
    </Pressable>
  );
  return (
    <View style={[styles.stepperRow, { gap: theme.space.md }]}>
      <View
        style={[
          styles.stepper,
          { borderColor: theme.colors.divider, borderRadius: theme.radius.md },
        ]}
        accessibilityLabel={`${title}, quantity ${quantity}`}>
        {control(quantity > 1 ? `One fewer ${title}` : `Remove ${title}`, '−', quantity - 1)}
        <Text variant="label" style={styles.quantity}>
          {quantity}
        </Text>
        {control(`One more ${title}`, '+', quantity + 1)}
      </View>
      <Button label="Remove" variant="link" disabled={disabled} onPress={() => onChange(0)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  row: { flexDirection: 'row', alignItems: 'flex-start', borderBottomWidth: StyleSheet.hairlineWidth },
  thumb: { width: 72, height: 72 },
  details: { flex: 1 },
  stepperRow: { flexDirection: 'row', alignItems: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1 },
  stepperButton: { alignItems: 'center', justifyContent: 'center' },
  quantity: { minWidth: 24, textAlign: 'center' },
  pressed: { opacity: 0.6 },
  removeOnly: { alignSelf: 'flex-start' },
});
