import { vendorTheme } from '@oja/ui';
import { Stack } from 'expo-router';

import { useKeepCurrentShop } from '@/session/keep-current-shop';

// The order stack (accept → pick → pack → label → handover) is pushed over the list.
export default function AppLayout() {
  useKeepCurrentShop();

  return (
    <Stack
      screenOptions={{
        headerTintColor: vendorTheme.colors.ink,
        contentStyle: { backgroundColor: vendorTheme.colors.background },
      }}>
      {/* Listed first: the first screen declared here is the one the stack opens on. */}
      <Stack.Screen name="index" />
      <Stack.Screen name="orders/[id]/index" options={{ title: 'Order' }} />
      {/* The reject reason sheet slides up over the order. */}
      <Stack.Screen
        name="orders/[id]/reject"
        options={{ presentation: 'formSheet', headerShown: false, sheetAllowedDetents: 'fitToContents' }}
      />
      {/* The pick list and packed screens set their own titles. */}
      <Stack.Screen name="orders/[id]/pick" />
      {/* The scanner fills the screen; Done returns to the pick list. */}
      <Stack.Screen name="orders/[id]/scan" options={{ presentation: 'fullScreenModal', headerShown: false }} />
      <Stack.Screen name="orders/[id]/packed" options={{ headerBackVisible: false }} />
    </Stack>
  );
}
