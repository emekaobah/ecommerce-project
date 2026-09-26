import { listStoreProducts } from '@oja/api-client';
import { formatMoney } from '@oja/domain';
import { EmptyState, ErrorState, ListRow, LoadingState, Text, useTheme } from '@oja/ui';
import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { storeClient } from '@/lib/api';

type ProductRow = { id: string; title: string; thumbnail: string | null; price: string | null };

export default function CatalogueScreen() {
  const theme = useTheme();
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    (async () => {
      // Region-aware from day one: prices come from the region's currency, never a hardcoded one.
      const { regions } = await storeClient.store.regions.query();
      const region = regions[0];
      if (!region) throw new Error('No region configured');
      const { products } = await listStoreProducts(storeClient, { regionId: region.id });
      setProducts(
        products.map((p) => {
          const amount = p.variants?.[0]?.calculated_price?.calculated_amount;
          return {
            id: p.id,
            title: p.title,
            thumbnail: p.thumbnail,
            price: amount != null ? formatMoney(amount, region.currency_code) : null,
          };
        })
      );
    })().catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <Text variant="title" style={styles.heading}>
          Oja
        </Text>
        {error ? (
          <ErrorState title="Couldn't load products" message={error} onRetry={load} />
        ) : !products ? (
          <LoadingState />
        ) : (
          <FlatList
            data={products}
            keyExtractor={(p) => p.id}
            contentContainerStyle={{ paddingBottom: BottomTabInset + Spacing.three }}
            ListEmptyComponent={<EmptyState title="No products yet" message="Check back soon." />}
            renderItem={({ item }) => (
              <ListRow
                title={item.title}
                subtitle={item.price ?? undefined}
                leading={
                  item.thumbnail ? (
                    <Image
                      source={item.thumbnail}
                      contentFit="contain"
                      style={[styles.thumb, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm }]}
                    />
                  ) : null
                }
              />
            )}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four, gap: Spacing.three },
  heading: { marginTop: Spacing.three },
  thumb: { width: 64, height: 64 },
});
