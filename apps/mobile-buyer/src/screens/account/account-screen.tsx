import { useAuth, useClerk } from '@clerk/expo';
import { Button, ErrorState, ListRow, LoadingState, Text, useTheme } from '@oja/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCustomer, type Customer } from '@/api/customer';
import { SignInPrompt } from '@/components/sign-in-prompt';

export function AccountScreen() {
  const theme = useTheme();
  const { isSignedIn, userId } = useAuth();
  const customer = useCustomer(isSignedIn ? userId : null);

  const content = () => {
    // The root layout waits for Clerk to restore the session, so this is never a false "signed out".
    if (!isSignedIn) {
      return <SignInPrompt title="Sign in to Oja" message="Check out, track your orders and save favourites." />;
    }
    if (customer.error && !customer.data) {
      return (
        <ErrorState
          title="Couldn't load your account"
          message={customer.error.message}
          onRetry={() => void customer.refetch()}
        />
      );
    }
    if (!customer.data) return <LoadingState />;
    return <SignedIn customer={customer.data} />;
  };

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.container, { backgroundColor: theme.colors.background, paddingHorizontal: theme.space.md }]}>
      <Text variant="title" style={{ marginVertical: theme.space.md }}>
        Account
      </Text>
      {content()}
    </SafeAreaView>
  );
}

function SignedIn({ customer }: Readonly<{ customer: Customer }>) {
  const theme = useTheme();
  const { signOut } = useClerk();
  const [signingOut, setSigningOut] = useState(false);
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ');

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      // The root layout clears cached data when the buyer changes.
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <View style={{ gap: theme.space.lg }}>
      <View style={{ gap: theme.space.xs }}>
        {name ? <Text variant="heading">{name}</Text> : null}
        <Text tone="secondary">{customer.email}</Text>
      </View>
      <ListRow title="Wishlist" subtitle="Products you saved" onPress={() => router.push('/wishlist')} />
      <ListRow title="Addresses" subtitle="Where your deliveries go" onPress={() => router.push('/addresses')} />
      <Button label="Sign out" variant="secondary" loading={signingOut} onPress={() => void onSignOut()} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
