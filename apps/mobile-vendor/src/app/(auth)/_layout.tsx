import { vendorTheme } from '@oja/ui';
import { Stack } from 'expo-router';

import { useSessionState } from '@/session/session-store';

// Sign-in, then the shop picker for a member of several shops.
export default function AuthLayout() {
  const choosingShop = useSessionState().status === 'choosingShop';
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: vendorTheme.colors.background } }}>
      <Stack.Protected guard={!choosingShop}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={choosingShop}>
        <Stack.Screen name="shop-picker" />
      </Stack.Protected>
    </Stack>
  );
}
