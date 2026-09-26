import { router } from 'expo-router';

import { PlaceholderScreen } from '@/components/placeholder-screen';

export default function CartRoute() {
  return <PlaceholderScreen title="Cart" action={{ label: 'Checkout', onPress: () => router.push('/checkout') }} />;
}
