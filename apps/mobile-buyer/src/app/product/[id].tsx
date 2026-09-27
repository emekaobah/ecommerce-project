import { useLocalSearchParams } from 'expo-router';

import { ProductScreen } from '@/screens/product/product-screen';

export default function ProductRoute() {
  const { id, seller } = useLocalSearchParams<{ id: string; seller?: string }>();
  return <ProductScreen productId={id} sellerId={seller} />;
}
