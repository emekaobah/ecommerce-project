import { useTheme } from '@oja/ui';
import { NativeTabs } from 'expo-router/native-tabs';

import { useCart } from '@/api/cart';
import { useCartSession } from '@/cart/cart-provider';

/**
 * The buyer app's native tab bar (Foundations, Android and the tab bar): the platform's own bar
 * and SF Symbols / Material Symbols icons, with the active tab in accent and the rest in the
 * inactive tab colour, in both themes. The cart's badge counts its items.
 */
export default function TabsLayout() {
  const theme = useTheme();
  const { cartId } = useCartSession();
  const itemCount = useCart(cartId).data?.item_count ?? 0;
  return (
    <NativeTabs
      backgroundColor={theme.colors.raised}
      tintColor={theme.colors.accent}
      badgeBackgroundColor={theme.colors.accent}
      iconColor={{ default: theme.colors.tabInactive, selected: theme.colors.accent }}
      labelStyle={{ default: { color: theme.colors.tabInactive }, selected: { color: theme.colors.accent } }}>
      {/* Home's band runs under the status bar, so Home pads its own insets. */}
      <NativeTabs.Trigger name="index" disableAutomaticContentInsets>
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
