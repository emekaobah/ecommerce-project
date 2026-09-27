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
      }}
    />
  );
}
