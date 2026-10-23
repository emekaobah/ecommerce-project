import { useAuth } from '@clerk/expo';
import { AuthView } from '@clerk/expo/native-components';
import { AdirePattern, Text, useTheme } from '@oja/ui';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LightStatusBar } from '@/components/light-status-bar';

/** What Clerk's first step needs: email, Continue, then Apple and Google. */
const FORM_HEIGHT = 420;

const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

/**
 * Sign in: Oja's indigo band, then Clerk's native sign-in-or-up (Apple and Google first, then
 * email, as enabled for the Clerk instance; coloured by `clerk-theme.json`), and a way to keep
 * browsing as a guest. Needs a development build; the session syncs to the JS SDK on its own.
 */
export function SignInScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Default `useAuth` treats a session with pending tasks as signed out, so the modal stays
  // open until AuthView has finished them and the session is active.
  const { isSignedIn } = useAuth();

  useEffect(() => {
    if (isSignedIn) close();
  }, [isSignedIn]);

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.bg }]}>
      <LightStatusBar />
      {/* The band takes the space Clerk's form leaves, its words pinned to the foot; the pattern
          fades out above them, so the type sits on plain indigo. */}
      <View style={[styles.band, { backgroundColor: theme.colors.band }]}>
        <View style={styles.pattern}>
          <AdirePattern fade="top" opacity={0.55} />
        </View>
        <View style={{ paddingHorizontal: theme.space[6], paddingBottom: theme.space[6], gap: theme.space[2] }}>
          <Text variant="displayXxl" tone="onBand" accessibilityRole="header" accessibilityLabel="Oja">
            oja
          </Text>
          <Text variant="titleNamed" tone="onBand">
            {'Your neighbourhood\nshops, in one app.'}
          </Text>
          <Text variant="meta" tone="onBand" style={styles.subtitle}>
            Shop the stores around you. Get it delivered, or pick it up on your way.
          </Text>
        </View>
      </View>
      <View style={[styles.form, { minHeight: FORM_HEIGHT }]}>
        <AuthView onDismiss={close} isDismissible={false} logo={<View />} logoMaxHeight={1} />
      </View>
      <Text
        variant="meta"
        tone="muted"
        style={[styles.centred, { paddingTop: theme.space[2], paddingBottom: Math.max(insets.bottom, theme.space[4]) }]}>
        {'Signing in keeps your cart. '}
        <Text variant="meta" weight="bold" tone="accent" accessibilityRole="link" onPress={close} suppressHighlighting={false}>
          Browse first
        </Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  band: { flex: 1, overflow: 'hidden', justifyContent: 'flex-end' },
  // The pattern fills the band above its words and fades out before them.
  pattern: { flex: 1 },
  form: { flexShrink: 0 },
  subtitle: { opacity: 0.85 },
  centred: { textAlign: 'center' },
});
