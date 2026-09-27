import { useAuth } from '@clerk/expo';
import { router } from 'expo-router';

import { PlaceholderScreen } from '@/components/placeholder-screen';

export function CartScreen() {
  const { isSignedIn } = useAuth();
  // Checkout is protected; a guest goes through the sign-in modal first (ADR 0001).
  const checkout = () => router.push(isSignedIn ? '/checkout' : '/sign-in');
  return <PlaceholderScreen title="Cart" action={{ label: 'Checkout', onPress: checkout }} />;
}
