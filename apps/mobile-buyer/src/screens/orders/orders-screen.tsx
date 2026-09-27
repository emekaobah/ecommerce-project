import { useAuth } from '@clerk/expo';
import { useTheme } from '@oja/ui';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { SignInPrompt } from '@/components/sign-in-prompt';

/**
 * Orders need a signed-in buyer (ADR 0001). As a tab it can't be a protected route without
 * hiding the tab, so a guest sees the way into the sign-in modal instead.
 */
export function OrdersScreen() {
  const theme = useTheme();
  const { isSignedIn } = useAuth();
  if (isSignedIn) return <PlaceholderScreen title="Orders" />;
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <SignInPrompt title="Your orders" message="Sign in to see and track your orders." />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
