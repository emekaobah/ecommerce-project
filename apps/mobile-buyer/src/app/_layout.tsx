import { buyerTheme, ThemeProvider } from '@oja/ui';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { queryClient } from '@/api/query-client';
import { RegionProvider } from '@/region/region-provider';

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={buyerTheme}>
        <RegionProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerTintColor: buyerTheme.colors.ink,
              contentStyle: { backgroundColor: buyerTheme.colors.background },
            }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="product/[id]" options={{ title: '' }} />
            <Stack.Screen name="seller/[id]" options={{ title: '' }} />
            <Stack.Screen name="checkout" options={{ title: 'Checkout' }} />
            <Stack.Screen name="sign-in" options={{ presentation: 'modal', title: 'Sign in' }} />
          </Stack>
        </RegionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
