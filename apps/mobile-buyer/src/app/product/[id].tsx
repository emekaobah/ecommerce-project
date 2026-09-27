import { EmptyState } from '@oja/ui';
import { router, useLocalSearchParams } from 'expo-router';

import { ProductScreen } from '@/screens/product/product-screen';

// A product is always opened in one shop's context (docs/design.md), so the shop comes along.
export default function ProductRoute() {
  const { id, seller } = useLocalSearchParams<{ id: string; seller?: string }>();
  if (!seller) {
    return (
      <EmptyState
        title="Pick a shop"
        message="Open this product from a shop's listing."
        action={{ label: 'Back to shopping', onPress: () => router.back() }}
      />
    );
  }
  return <ProductScreen sellerId={seller} productId={id} />;
}
