import { useAuth } from '@clerk/expo';
import { formatMoney, shortLineLabel, soldOutButtonLabel, stockShortfall } from '@oja/domain';
import {
  Button,
  EmptyState,
  ErrorState,
  Group,
  GroupList,
  InlineNote,
  QuantityStepper,
  ShopMark,
  Skeleton,
  StatusChip,
  StickyAction,
  Text,
  useTheme,
  useToast,
} from '@oja/ui';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCart, useMoveShopToOwnCart, useSetCartItemQuantity, type Cart, type CartItem, type CartSellerGroup } from '@/api/cart';
import { isNotFound } from '@/api/errors';
import { useToggleWishlist } from '@/api/wishlist';
import { useCartSession } from '@/cart/cart-provider';
import { SumRow } from '@/components/cart/summary';
import { PerishableChip, PerishableRule } from '@/components/perishable';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';

/** The cart, a card per shop: each shop ships, and becomes an order, on its own. */
export function CartScreen() {
  const theme = useTheme();
  const toast = useToast();
  const { isSignedIn } = useAuth();
  const { cartId, forgetCart } = useCartSession();
  const cart = useCart(cartId);
  const cartMissing = isNotFound(cart.error);
  const { refreshing, refresh } = usePullToRefresh(async () => {
    const result = await cart.refetch();
    if (result.isError && cart.data) toast({ message: "Couldn't refresh your cart", tone: 'problem' });
  });

  useEffect(() => {
    if (cartMissing) forgetCart();
  }, [cartMissing, forgetCart]);

  const content = () => {
    if (cartId === null || cartMissing || cart.data?.item_count === 0) {
      return (
        <EmptyState
          icon="bag"
          title="Nothing in your cart yet"
          body="Start with the shops open near you, or pick up where you left off in your saved items."
          action={{ label: 'Browse shops near you', onPress: () => router.navigate('/') }}
          secondaryAction={{ label: 'See your saved items', onPress: () => router.push(isSignedIn ? '/wishlist' : '/sign-in') }}
        />
      );
    }
    // A failed refresh keeps the cart already on screen.
    if (cart.error && !cart.data) {
      return (
        <ErrorState
          title="Couldn't load your cart"
          body="Check your connection and try again. Anything in your cart is saved."
          error={cart.error}
          onRetry={() => void cart.refetch()}
        />
      );
    }
    if (!cartId || !cart.data) return <CartSkeleton />;
    return <CartContents cartId={cartId} cart={cart.data} refreshing={refreshing} onRefresh={refresh} />;
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.fill, { backgroundColor: theme.colors.bg }]}>
      <Text variant="titleRoot" style={{ paddingTop: theme.space[1], paddingBottom: theme.space[2], paddingHorizontal: theme.space[4] }}>
        Cart
      </Text>
      {content()}
    </SafeAreaView>
  );
}

/** A line that sold out since it was added (none left): it stays, greyed, until it's dealt with. */
const isSoldOut = (item: CartItem) => stockShortfall(item.quantity, item.available_quantity)?.type === 'sold_out';

function CartContents({
  cartId,
  cart,
  refreshing,
  onRefresh,
}: Readonly<{ cartId: string; cart: Cart; refreshing: boolean; onRefresh: () => void }>) {
  const theme = useTheme();
  const { isSignedIn } = useAuth();
  const setQuantity = useSetCartItemQuantity(cartId);
  const moveShopToOwnCart = useMoveShopToOwnCart(cartId);
  const saveForLater = useToggleWishlist();
  const [removingSoldOut, setRemovingSoldOut] = useState(false);
  const pendingItemId = setQuantity.isPending ? setQuantity.variables?.itemId : undefined;
  const currency = cart.currency_code;
  const money = (amount: number) => formatMoney(amount, currency);
  const soldOut = cart.sellers.flatMap((group) => (group.seller ? group.items.filter(isSoldOut) : []));
  const shops = cart.sellers.filter((group) => group.seller);

  // Checkout is protected; a guest goes through the sign-in modal first (ADR 0001).
  const checkout = () => router.push(isSignedIn ? '/checkout' : '/sign-in');
  // With several shops in the cart, one shop's items can be paid for on their own (#11): they
  // move to a shop cart, checked out like any other; the rest stays in this cart.
  const paysShopByShop = cart.sellers.length > 1;
  const checkoutShop = (sellerId: string) => {
    if (!isSignedIn) {
      router.push('/sign-in');
      return;
    }
    moveShopToOwnCart.mutate(sellerId, {
      onSuccess: (shopCart) => router.push({ pathname: '/checkout', params: { cartId: shopCart.id } }),
    });
  };
  // Checkout can't start while a line has none left: the main button clears them all, one at a
  // time, since each removal rewrites the same cart, and stops at the first that fails.
  const removeSoldOut = async () => {
    setRemovingSoldOut(true);
    try {
      await soldOut.reduce<Promise<void>>(
        (removed, item) => removed.then(() => setQuantity.mutateAsync({ itemId: item.id, quantity: 0 })),
        Promise.resolve(),
      );
    } catch {
      // The note above the button says so; what was removed stays removed.
    } finally {
      setRemovingSoldOut(false);
    }
  };
  // Saved items are the buyer's wishlist: the line goes there, then leaves the cart.
  const save = (group: CartSellerGroup, item: CartItem) => {
    if (!isSignedIn) {
      router.push('/sign-in');
      return;
    }
    if (!group.seller || !item.product_id) return;
    saveForLater.mutate(
      { sellerId: group.seller.id, productId: item.product_id, save: true },
      { onSuccess: () => setQuantity.mutate({ itemId: item.id, quantity: 0 }) },
    );
  };

  const problem = (() => {
    if (setQuantity.error) return "Couldn't update your cart. Check your connection and try again.";
    if (saveForLater.error) return "Couldn't save it for later. It's still in your cart.";
    if (moveShopToOwnCart.error) return "Couldn't check out that shop on its own. Your cart hasn't changed.";
    return null;
  })();

  return (
    <>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[6] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <GroupList>
          {cart.sellers.map((group) => {
            const { seller } = group;
            return (
              <ShopCard
                key={seller?.id ?? 'unavailable'}
                group={group}
                money={money}
                checkoutShop={
                  paysShopByShop && seller
                    ? {
                        onPress: () => checkoutShop(seller.id),
                        busy: moveShopToOwnCart.isPending && moveShopToOwnCart.variables === seller.id,
                        disabled: moveShopToOwnCart.isPending || !group.shop_status?.orderable || group.items.some(isSoldOut),
                      }
                    : null
                }>
                {group.items.map((item) => (
                  <CartLine
                    key={item.id}
                    item={item}
                    available={!!seller}
                    money={money}
                    busy={pendingItemId === item.id || (saveForLater.isPending && saveForLater.variables?.productId === item.product_id)}
                    onChange={(quantity) => setQuantity.mutate({ itemId: item.id, quantity })}
                    onSave={() => save(group, item)}
                  />
                ))}
              </ShopCard>
            );
          })}
          {shops.length > 1 ? <CartTotals cart={cart} money={money} /> : null}
        </GroupList>
      </ScrollView>
      {problem ? (
        <View style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[2], backgroundColor: theme.colors.bg }}>
          <InlineNote>{problem}</InlineNote>
        </View>
      ) : null}
      {soldOut.length ? (
        <StickyAction label={soldOutButtonLabel(soldOut.length)} onPress={() => void removeSoldOut()} loading={removingSoldOut} />
      ) : (
        <StickyAction
          label={shops.length > 1 ? `Checkout ${shops.length} shops` : 'Checkout'}
          price={money(cart.item_subtotal)}
          onPress={checkout}
        />
      )}
    </>
  );
}

/** "Closed · opens 10am Mon · prepared then": a shop that still takes orders while closed prepares them when it opens. */
function shopLine(group: CartSellerGroup): string | null {
  const status = group.shop_status;
  if (!status) return null;
  return status.state === 'closed' && status.orderable ? `${status.label} · prepared then` : status.label;
}

const itemCount = (group: CartSellerGroup) => group.items.reduce((sum, item) => sum + item.quantity, 0);
const itemsWord = (count: number) => `${count} ${count === 1 ? 'item' : 'items'}`;

/** One shop's part of the cart: its mark and status, its lines, then its subtotal. */
function ShopCard({
  group,
  money,
  checkoutShop,
  children,
}: Readonly<{
  group: CartSellerGroup;
  money: (amount: number) => string;
  /** "Checkout this shop", when the cart has more than one. */
  checkoutShop: { onPress: () => void; busy: boolean; disabled: boolean } | null;
  children: ReactNode;
}>) {
  const theme = useTheme();
  const { seller } = group;
  const status = shopLine(group);
  return (
    <Group>
      <View style={[styles.row, { gap: theme.space[2] }]}>
        {seller ? <ShopMark name={seller.name} logoUrl={seller.logo} size="md" /> : null}
        <View style={styles.fill}>
          <Text weight="extrabold">{seller?.name ?? 'No longer available'}</Text>
          {status ? (
            <Text variant="meta" tone="muted">
              {status}
            </Text>
          ) : null}
        </View>
      </View>
      {seller ? null : (
        <Text variant="meta" tone="muted">
          These shops stopped selling these items. Remove them to check out.
        </Text>
      )}
      {group.shop_status && !group.shop_status.orderable ? (
        <Text variant="meta" tone="muted">
          {"You can't order from this shop until it reopens."}
        </Text>
      ) : null}
      {seller && group.perishable ? <PerishableRule /> : null}
      <View style={{ gap: theme.space[3] }}>{children}</View>
      {seller ? (
        <View style={{ gap: theme.space[1], padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: theme.colors.tile }}>
          <View style={[styles.row, { gap: theme.space[3] }]}>
            <Text weight="bold" style={styles.fill}>
              Subtotal
            </Text>
            <Text weight="extrabold" tabular>
              {money(group.item_subtotal)}
            </Text>
          </View>
          <View style={[styles.row, { gap: theme.space[3] }]}>
            <Text variant="meta" tone="muted" numberOfLines={1} style={styles.fill}>{`${itemsWord(itemCount(group))} + delivery`}</Text>
            {checkoutShop ? (
              <Button
                label="Checkout this shop"
                variant="link"
                onPress={checkoutShop.onPress}
                loading={checkoutShop.busy}
                disabled={checkoutShop.disabled}
              />
            ) : null}
          </View>
        </View>
      ) : null}
    </Group>
  );
}

/** "Rice · 5kg": the product, with its size unless it has only the default one. */
function lineName(item: CartItem): string {
  const title = item.product_title ?? 'Item';
  const size = item.variant_title;
  return size && size !== 'Default' && size !== title ? `${title} · ${size}` : title;
}

/** "₦4,500 · was ₦5,000" on sale, else "₦4,500": one of the line's price. */
function unitPriceLabel(item: CartItem, money: (amount: number) => string): string {
  const price = money(item.unit_price);
  return item.compare_at_unit_price ? `${price} · was ${money(item.compare_at_unit_price)}` : price;
}

/**
 * A cart line: its photo, name and price, and its quantity. A sold-out line stays, greyed, with
 * Remove and Save for later; one wanting more than is left offers to change to what is.
 */
function CartLine({
  item,
  available,
  money,
  busy,
  onChange,
  onSave,
}: Readonly<{
  item: CartItem;
  /** False once the shop stopped selling it: it can only be removed. */
  available: boolean;
  money: (amount: number) => string;
  busy: boolean;
  onChange: (quantity: number) => void;
  onSave: () => void;
}>) {
  const theme = useTheme();
  const name = lineName(item);
  const shortfall = available ? stockShortfall(item.quantity, item.available_quantity) : null;
  const soldOut = shortfall?.type === 'sold_out';
  const greyed = soldOut || !available;
  const photo = theme.control.md;
  return (
    <View style={[styles.row, { gap: theme.space[2], opacity: busy ? 0.6 : 1 }]}>
      <View style={{ width: photo, height: photo, borderRadius: theme.radius.md, overflow: 'hidden', backgroundColor: theme.colors.productTile }}>
        {item.thumbnail ? (
          <Image source={item.thumbnail} contentFit="contain" style={[styles.fill, greyed ? styles.faded : null]} />
        ) : null}
      </View>
      <View style={[styles.fill, { gap: theme.space[1] }]}>
        <Text weight="bold" tone={greyed ? 'muted' : 'default'} numberOfLines={2}>
          {name}
        </Text>
        {soldOut ? (
          <StatusChip label="Sold out" tone="neutral" />
        ) : (
          <Text variant="meta" tone="muted" tabular>
            {unitPriceLabel(item, money)}
          </Text>
        )}
        {item.perishable && !greyed ? <PerishableChip /> : null}
        {item.discounts.map((discount) => (
          <Text key={discount.code} variant="meta" tone="leaf">
            {`${discount.code} −${money(discount.amount)}`}
          </Text>
        ))}
        {shortfall?.type === 'short' ? (
          <Button
            label={shortLineLabel(shortfall.left)}
            variant="link"
            disabled={busy}
            onPress={() => onChange(shortfall.left)}
            style={styles.start}
          />
        ) : null}
        {greyed ? (
          <View style={[styles.row, { gap: theme.space[4] }]}>
            <Button label="Remove" variant="link" disabled={busy} onPress={() => onChange(0)} />
            {soldOut ? <Button label="Save for later" variant="link" disabled={busy} onPress={onSave} /> : null}
          </View>
        ) : null}
      </View>
      {greyed ? (
        <Text weight="extrabold" tone="muted" tabular>
          {money(item.subtotal)}
        </Text>
      ) : (
        <QuantityStepper
          value={item.quantity}
          min={0}
          available={item.available_quantity}
          name={name}
          size="line"
          disabled={busy}
          onChange={onChange}
        />
      )}
    </View>
  );
}

/** Each shop's subtotal, then what the items come to: delivery is priced per shop at checkout. */
function CartTotals({ cart, money }: Readonly<{ cart: Cart; money: (amount: number) => string }>) {
  return (
    <Group gap={2}>
      {cart.sellers.flatMap((group) =>
        group.seller ? [<SumRow key={group.seller.id} label={group.seller.name} value={money(group.item_subtotal)} />] : [],
      )}
      <SumRow label="Items total" value={money(cart.item_subtotal)} total />
    </Group>
  );
}

/** The cart's shape while it loads: a shop's group with two lines. */
function CartSkeleton() {
  const theme = useTheme();
  const photo = theme.control.md;
  return (
    <View style={{ paddingHorizontal: theme.space[4] }} accessible accessibilityLabel="Loading your cart">
      <Group>
        <View style={[styles.row, { gap: theme.space[2] }]}>
          <Skeleton width={theme.shopMark.md.size} height={theme.shopMark.md.size} radius="md" />
          <Skeleton width="50%" height={theme.type.body.fontSize} />
        </View>
        {[0, 1].map((line) => (
          <View key={line} style={[styles.row, { gap: theme.space[2] }]}>
            <Skeleton width={photo} height={photo} radius="md" />
            <View style={[styles.fill, { gap: theme.space[1] }]}>
              <Skeleton width="70%" height={theme.type.body.fontSize} />
              <Skeleton width="30%" height={theme.type.meta.fontSize} />
            </View>
          </View>
        ))}
      </Group>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  start: { alignSelf: 'flex-start' },
  faded: { opacity: 0.5 },
});
