import { router } from 'expo-router';

import { PlaceholderScreen } from '@/components/placeholder-screen';

export default function AccountRoute() {
  return <PlaceholderScreen title="Account" action={{ label: 'Sign in', onPress: () => router.push('/sign-in') }} />;
}
