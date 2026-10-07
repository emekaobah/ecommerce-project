import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { buyerTheme, ThemeProvider } from '@oja/ui';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { queryClient } from '@/api/query-client';
import { CartProvider } from '@/cart/cart-provider';
import { env } from '@/config/env';
import { usePushRegistration } from '@/push/push-registration';
import { useOpenTappedPush } from '@/push/use-open-tapped-push';
import { RegionProvider } from '@/region/region-provider';
import { useClearCacheOnUserChange } from '@/session/use-clear-cache-on-user-change';

// Keep the splash up until Clerk has restored the session, so guards never see a false "signed out".
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    // The token cache keeps the session in the keychain, so it survives app restarts.
    <ClerkProvider publishableKey={env.clerkPublishableKey} tokenCache={tokenCache}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={buyerTheme}>
          <RegionProvider>
            <CartProvider>
              <StatusBar style="dark" />
              <RootStack />
            </CartProvider>
          </RegionProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function RootStack() {
  const { isLoaded, isSignedIn } = useAuth();
  useClearCacheOnUserChange();
  usePushRegistration();
  useOpenTappedPush(isLoaded);

  useEffect(() => {
    if (isLoaded) SplashScreen.hide();
  }, [isLoaded]);

  if (!isLoaded) return null;

  return (
    <Stack
      screenOptions={{
        headerTintColor: buyerTheme.colors.ink,
        // A bare chevron: the tab group has no title, so a labelled back button read "(tabs)".
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: buyerTheme.colors.background },
      }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="product/[id]" options={{ title: '' }} />
      <Stack.Screen name="seller/[id]" options={{ title: '' }} />
      <Stack.Screen name="category/[id]" options={{ title: '' }} />
      {/* Guests browse freely; checkout, orders and the wishlist need a signed-in buyer (ADR 0001). */}
      <Stack.Protected guard={isSignedIn}>
        <Stack.Screen name="checkout/index" options={{ title: 'Checkout' }} />
        {/* Paying ends in the confirmation screen, or back at checkout to try again. */}
        <Stack.Screen name="checkout/pay" options={{ title: 'Pay with Paystack', gestureEnabled: false }} />
        <Stack.Screen name="checkout/confirmation" options={{ title: 'Confirming payment', gestureEnabled: false }} />
        <Stack.Screen name="wishlist" options={{ title: 'Wishlist' }} />
        <Stack.Screen name="addresses/index" options={{ title: 'Addresses' }} />
        <Stack.Screen name="addresses/edit" options={{ title: 'Address' }} />
        <Stack.Screen name="order/[id]" options={{ title: 'Order' }} />
      </Stack.Protected>
      {/* AuthView draws its own chrome, including the dismiss button. */}
      <Stack.Screen name="sign-in" options={{ presentation: 'modal', headerShown: false }} />
    </Stack>
  );
}
