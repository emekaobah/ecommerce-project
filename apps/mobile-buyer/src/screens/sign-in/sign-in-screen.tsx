import { useAuth } from '@clerk/expo';
import { AuthView } from '@clerk/expo/native-components';
import { AdirePattern, Text, TopBandScreen, useTheme, useTopBand } from '@oja/ui';
import { router, useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Clerk's first step at rest: email, Continue, then Apple and Google. The hero takes the rest. */
const FORM_HEIGHT = 470;

/** Whether the keyboard is up, so Clerk's form can take the screen while the buyer types. */
function useKeyboardShown() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setShown(true));
    const hide = Keyboard.addListener('keyboardWillHide', () => setShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return shown;
}

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
  const typing = useKeyboardShown();
  // The screen doesn't scroll, so its band stays behind the status bar.
  const band = useTopBand();
  const focused = useIsFocused();

  useEffect(() => {
    if (isSignedIn) close();
  }, [isSignedIn]);

  return (
    <TopBandScreen band={band} focused={focused}>
      {/* The band runs to the top edge and takes the room the form leaves, its words at its foot;
          the pattern fades out above them, so the type sits on plain indigo. While the buyer types
          it folds to the status bar, so all of Clerk's form (and its other sign-in methods) stays
          above the keyboard. */}
      {typing ? (
        <View style={{ height: insets.top, backgroundColor: theme.colors.band }} />
      ) : (
        <View style={[styles.band, { backgroundColor: theme.colors.band }]}>
          <View style={[styles.fill, { minHeight: insets.top + theme.space[12] }]}>
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
      )}
      <View style={typing ? styles.fill : { height: FORM_HEIGHT }}>
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
    </TopBandScreen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  band: { flex: 1, justifyContent: 'flex-end' },
  subtitle: { opacity: 0.85 },
  centred: { textAlign: 'center' },
});
