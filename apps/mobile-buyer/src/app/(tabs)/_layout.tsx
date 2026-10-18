import { useTheme } from '@oja/ui';
import { NativeTabs } from 'expo-router/native-tabs';

import { useCart } from '@/api/cart';
import { useCartSession } from '@/cart/cart-provider';

export default function TabsLayout() {
  const theme = useTheme();
  const { cartId } = useCartSession();
  const itemCount = useCart(cartId).data?.item_count ?? 0;
  return (
    <NativeTabs
      backgroundColor={theme.colors.background}
      tintColor={theme.colors.accent}
      badgeBackgroundColor={theme.colors.accent}
      labelStyle={{ selected: { color: theme.colors.accent } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search">
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="cart">
        <NativeTabs.Trigger.Label>Cart</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'cart', selected: 'cart.fill' }} md="shopping_cart" />
        <NativeTabs.Trigger.Badge hidden={itemCount === 0}>{itemCount ? String(itemCount) : undefined}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="orders">
        <NativeTabs.Trigger.Label>Orders</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'shippingbox', selected: 'shippingbox.fill' }} md="package_2" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person', selected: 'person.fill' }} md="person" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
