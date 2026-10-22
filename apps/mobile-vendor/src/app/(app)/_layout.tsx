import { useTheme } from '@oja/ui';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { usePushRegistration } from '@/push/push-registration';
import { useOpenTappedPush } from '@/push/use-open-tapped-push';
import { useKeepCurrentShop } from '@/session/keep-current-shop';

// The order stack (accept → pick → pack → label → handover) is pushed over the list.
export default function AppLayout() {
  const theme = useTheme();
  useKeepCurrentShop();
  usePushRegistration();
  useOpenTappedPush();

  // The orders list draws its own header on the page; every screen pushed over it has an indigo one.
  const onOrders = usePathname() === '/';

  return (
    <>
      <StatusBar style={onOrders ? 'auto' : 'light'} />
      <Stack
        screenOptions={{
          // Indigo in both themes, like the bands they lead into. Opaque: SDK 58's default Liquid
          // Glass header is transparent and lays each screen's content under it.
          headerTintColor: theme.colors.onBand,
          headerTitleStyle: { fontFamily: theme.type.titlePushed.fontFamily, color: theme.colors.onBand },
          headerStyle: { backgroundColor: theme.colors.band },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.colors.bg },
        }}>
        {/* Listed first: the first screen declared here is the one the stack opens on. */}
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="orders/[id]/index" options={{ title: 'Order' }} />
        {/* The reject reason sheet slides up over the order. */}
        <Stack.Screen
          name="orders/[id]/reject"
          options={{ presentation: 'formSheet', headerShown: false, sheetAllowedDetents: 'fitToContents' }}
        />
        {/* Cancelling an accepted order (#17): the reason, then the refund it makes. */}
        <Stack.Screen name="orders/[id]/cancel" options={{ title: 'Cancel order' }} />
        {/* The pick list and packed screens set their own titles. */}
        <Stack.Screen name="orders/[id]/pick" />
        {/* The scanner fills the screen; Done returns to the pick list. */}
        <Stack.Screen name="orders/[id]/scan" options={{ presentation: 'fullScreenModal', headerShown: false }} />
        {/* Partial availability (#22): how many of a line are unavailable, then the refund summary. */}
        <Stack.Screen
          name="orders/[id]/unavailable"
          options={{ presentation: 'formSheet', headerShown: false, sheetAllowedDetents: 'fitToContents' }}
        />
        <Stack.Screen name="orders/[id]/remove-unavailable" options={{ title: 'Remove unavailable items' }} />
        <Stack.Screen name="orders/[id]/packed" options={{ headerBackVisible: false }} />
        {/* In-store pickup (#12): scan or type the buyer's code, then hand the order over. */}
        <Stack.Screen name="orders/[id]/collect" />
        {/* Quick-add (#38): the scanner fills the screen, then the product's form and its confirmation. */}
        <Stack.Screen name="quick-add/index" options={{ presentation: 'fullScreenModal', headerShown: false }} />
        <Stack.Screen name="quick-add/[barcode]" />
        <Stack.Screen name="quick-add/done" options={{ headerBackVisible: false }} />
      </Stack>
    </>
  );
}
