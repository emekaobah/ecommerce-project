import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { buyerTheme, ThemeProvider } from '@oja/ui';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { queryClient } from '@/api/query-client';
import { env } from '@/config/env';
import { RegionProvider } from '@/region/region-provider';

export default function RootLayout() {
  return (
    // The token cache keeps the session in the keychain, so it survives app restarts.
    <ClerkProvider publishableKey={env.clerkPublishableKey} tokenCache={tokenCache}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={buyerTheme}>
          <RegionProvider>
            <StatusBar style="dark" />
            <RootStack />
          </RegionProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function RootStack() {
  const { isSignedIn } = useAuth();
  return (
    <Stack
      screenOptions={{
        headerTintColor: buyerTheme.colors.ink,
        contentStyle: { backgroundColor: buyerTheme.colors.background },
      }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="product/[id]" options={{ title: '' }} />
      <Stack.Screen name="seller/[id]" options={{ title: '' }} />
      {/* Guests browse freely; checkout needs a signed-in buyer (ADR 0001). */}
      <Stack.Protected guard={!!isSignedIn}>
        <Stack.Screen name="checkout" options={{ title: 'Checkout' }} />
      </Stack.Protected>
      {/* AuthView draws its own chrome, including the dismiss button. */}
      <Stack.Screen name="sign-in" options={{ presentation: 'modal', headerShown: false }} />
    </Stack>
  );
}
