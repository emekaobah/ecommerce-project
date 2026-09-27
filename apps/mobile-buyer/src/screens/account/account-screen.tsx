import { useAuth, useClerk } from '@clerk/expo';
import { Button, EmptyState, ErrorState, LoadingState, Text, useTheme } from '@oja/ui';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { customerKeys, useCustomer, type Customer } from '@/api/customer';

export function AccountScreen() {
  const theme = useTheme();
  const { isLoaded, isSignedIn, userId } = useAuth();
  const customer = useCustomer(isSignedIn ? userId : null);

  const content = () => {
    // Clerk restores the session from the keychain first; don't flash the signed-out state.
    if (!isLoaded) return <LoadingState />;
    if (!isSignedIn) {
      return (
        <EmptyState
          title="Sign in to Oja"
          message="Check out, track your orders and save favourites."
          action={{ label: 'Sign in', onPress: () => router.push('/sign-in') }}
        />
      );
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
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ');

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      queryClient.removeQueries({ queryKey: customerKeys.all });
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
      <Button label="Sign out" variant="secondary" loading={signingOut} onPress={() => void onSignOut()} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
