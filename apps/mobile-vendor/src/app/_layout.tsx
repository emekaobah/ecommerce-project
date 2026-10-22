import { initSentry, useSentryNavigation, withSentry } from '@oja/expo-sentry';
import { ThemeProvider, ToastProvider } from '@oja/ui';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { queryClient } from '@/api/query-client';
import { env } from '@/config/env';
import { createNewOrderChannel } from '@/push/new-order-channel';
import { hydrateSession, useSessionState } from '@/session/session-store';

initSentry(env.sentryDsn);

// A new order's push rings on its own channel, which must exist before the first one arrives.
void createNewOrderChannel();

// Keep the splash up until the stored session is read, so the first frame is already the right group.
void SplashScreen.preventAutoHideAsync();
void hydrateSession();

export default withSentry(RootLayout);

function RootLayout() {
  useSentryNavigation();
  const session = useSessionState();
  const hydrated = session.status !== 'hydrating';
  const signedIn = session.status === 'signedIn';
  const choosingShop = session.status === 'choosingShop';

  useEffect(() => {
    if (hydrated) SplashScreen.hide();
  }, [hydrated]);

  if (!hydrated) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false }}>
            {/* Flipping a guard redirects to the group that is allowed: sign-out lands on sign-in, and a
                member who must pick a shop (several shops, none saved or the saved one lost) on the
                picker, which (auth) shows instead of sign-in. */}
            <Stack.Protected guard={signedIn} redirectTo={choosingShop ? '/shop-picker' : '/sign-in'}>
              <Stack.Screen name="(app)" />
            </Stack.Protected>
            <Stack.Protected guard={!signedIn} redirectTo="/">
              <Stack.Screen name="(auth)" />
            </Stack.Protected>
          </Stack>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
