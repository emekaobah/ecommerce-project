import { useLocalSearchParams } from 'expo-router';

import { PlaceholderScreen } from '@/components/placeholder-screen';

export default function ProductRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PlaceholderScreen title="Product" message={id} />;
}
