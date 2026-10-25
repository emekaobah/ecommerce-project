import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { initSentry, useSentryNavigation, withSentry } from '@oja/expo-sentry';
import { ThemeProvider, ToastProvider, useTheme } from '@oja/ui';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { queryClient } from '@/api/query-client';
import { CartProvider } from '@/cart/cart-provider';
import { env } from '@/config/env';
import { AddressPromptProvider } from '@/delivering-to/address-prompt-provider';
import { DeliveringToProvider } from '@/delivering-to/delivering-to-provider';
import { usePushRegistration } from '@/push/push-registration';
import { useOpenTappedPush } from '@/push/use-open-tapped-push';
import { RegionProvider } from '@/region/region-provider';
import { useClearCacheOnUserChange } from '@/session/use-clear-cache-on-user-change';

initSentry(env.sentryDsn);

// Keep the splash up until Clerk has restored the session, so guards never see a false "signed out".
void SplashScreen.preventAutoHideAsync();

export default withSentry(RootLayout);

function RootLayout() {
  useSentryNavigation();
  return (
    // The token cache keeps the session in the keychain, so it survives app restarts.
    <ClerkProvider publishableKey={env.clerkPublishableKey} tokenCache={tokenCache}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ToastProvider>
            <RegionProvider>
              <CartProvider>
                <DeliveringToProvider>
                  <AddressPromptProvider>
                    <StatusBar style="auto" />
                    <RootStack />
                  </AddressPromptProvider>
                </DeliveringToProvider>
              </CartProvider>
            </RegionProvider>
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function RootStack() {
  const theme = useTheme();
  const { isLoaded, isSignedIn } = useAuth();
  useClearCacheOnUserChange();
  usePushRegistration();
  useOpenTappedPush(isLoaded);

  useEffect(() => {
    if (isLoaded) SplashScreen.hide();
  }, [isLoaded]);

  if (!isLoaded) return null;

  // Sheets slide up with the platform's own presentation, its grabber and the sheet corner radius.
  const formSheet = {
    presentation: 'formSheet',
    headerShown: false,
    sheetAllowedDetents: 'fitToContents',
    sheetGrabberVisible: true,
    sheetCornerRadius: theme.radius.sheet,
  } as const;

  return (
    <Stack
      screenOptions={{
        headerTintColor: theme.colors.ink,
        headerTitleStyle: { fontFamily: theme.type.titlePushed.fontFamily, color: theme.colors.ink },
        // An opaque header: SDK 58's default Liquid Glass header is transparent and lays each
        // screen's content under it.
        headerStyle: { backgroundColor: theme.colors.bg },
        // A bare chevron: the tab group has no title, so a labelled back button read "(tabs)".
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: theme.colors.bg },
      }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="product/[id]" options={{ title: '' }} />
      <Stack.Screen name="seller/[id]" options={{ title: '' }} />
      <Stack.Screen name="category/[id]" options={{ title: '' }} />
      <Stack.Screen name="reviews" options={{ title: 'Reviews' }} />
      {/* Guests browse freely; checkout, orders, reviewing and the wishlist need a signed-in buyer (ADR 0001). */}
      <Stack.Protected guard={isSignedIn}>
        <Stack.Screen name="checkout/index" options={{ title: 'Checkout' }} />
        {/* What changed when a payment didn't start slides up over Review and pay. */}
        <Stack.Screen
          name="checkout/changes"
          options={formSheet}
        />
        {/* Paying ends in the confirmation screen, or back at checkout to try again. */}
        <Stack.Screen name="checkout/pay" options={{ title: 'Pay', gestureEnabled: false }} />
        <Stack.Screen name="checkout/confirmation" options={{ title: 'Order', gestureEnabled: false }} />
        <Stack.Screen name="wishlist" options={{ title: 'Wishlist' }} />
        <Stack.Screen name="addresses/index" options={{ title: 'Addresses' }} />
        <Stack.Screen name="addresses/edit" options={{ title: 'Address' }} />
        <Stack.Screen name="delivering-to" options={{ title: 'Delivering to' }} />
        <Stack.Screen name="order/[id]" options={{ title: 'Order' }} />
        <Stack.Screen name="pickup/[id]" options={{ presentation: 'fullScreenModal', headerShown: false }} />
        <Stack.Screen name="review/[id]" options={{ title: 'Review' }} />
        <Stack.Screen name="my-reviews" options={{ title: 'My reviews' }} />
        <Stack.Screen name="refund/[id]" options={{ title: 'Refund' }} />
      </Stack.Protected>
      {/* AuthView draws its own chrome, including the dismiss button. Full screen, so the indigo runs to the top edge. */}
      <Stack.Screen name="sign-in" options={{ presentation: 'fullScreenModal', headerShown: false }} />
    </Stack>
  );
}
