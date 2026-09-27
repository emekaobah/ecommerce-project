import { useAuth } from '@clerk/expo';
import { LoadingState } from '@oja/ui';
import { router } from 'expo-router';

import { PlaceholderScreen } from '@/components/placeholder-screen';

/** Orders need a signed-in buyer; a guest is offered the sign-in modal (ADR 0001). */
export function OrdersScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <LoadingState />;
  if (!isSignedIn) {
    return (
      <PlaceholderScreen
        title="Your orders"
        message="Sign in to see and track your orders."
        action={{ label: 'Sign in', onPress: () => router.push('/sign-in') }}
      />
    );
  }
  return <PlaceholderScreen title="Orders" />;
}
