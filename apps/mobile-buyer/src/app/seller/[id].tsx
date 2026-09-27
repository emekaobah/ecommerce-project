import { useLocalSearchParams } from 'expo-router';

import { SellerScreen } from '@/screens/seller/seller-screen';

export default function SellerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SellerScreen sellerId={id} />;
}
