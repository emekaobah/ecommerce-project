import { useLocalSearchParams } from 'expo-router';

import { PlaceholderScreen } from '@/components/placeholder-screen';

export default function SellerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PlaceholderScreen title="Shop" message={id} />;
}
