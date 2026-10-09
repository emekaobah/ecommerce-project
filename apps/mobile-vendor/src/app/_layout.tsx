import { ThemeProvider, vendorTheme } from '@oja/ui';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { queryClient } from '@/api/query-client';
import { withSentry } from '@/monitoring/sentry';
import { hydrateSession, useSessionState } from '@/session/session-store';

// Keep the splash up until the stored session is read, so the first frame is already the right group.
void SplashScreen.preventAutoHideAsync();
void hydrateSession();

export default withSentry(RootLayout);

function RootLayout() {
  const session = useSessionState();
  const hydrated = session.status !== 'hydrating';
  const signedIn = session.status === 'signedIn';

  useEffect(() => {
    if (hydrated) SplashScreen.hide();
  }, [hydrated]);

  if (!hydrated) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={vendorTheme}>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }}>
          {/* Flipping a guard redirects to the group that is allowed: sign-out lands on sign-in. */}
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(app)" />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
        </Stack>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
