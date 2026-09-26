import { formatMoney, listStoreProducts } from '@oja/api-client';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { storeClient } from '@/lib/api';

type ProductRow = { id: string; title: string; thumbnail: string | null; price: string | null };

export default function CatalogueScreen() {
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ThemedText type="title" style={styles.heading}>
          Oja
        </ThemedText>
        {error ? (
          <ThemedText>Couldn&apos;t load products: {error}</ThemedText>
        ) : !products ? (
          <ActivityIndicator />
        ) : (
          <FlatList
            data={products}
            keyExtractor={(p) => p.id}
            contentContainerStyle={{ paddingBottom: BottomTabInset + Spacing.three, gap: Spacing.three }}
            renderItem={({ item }) => (
              <ThemedView type="backgroundElement" style={styles.row}>
                {item.thumbnail ? <Image source={item.thumbnail} style={styles.thumb} /> : null}
                <ThemedView style={styles.rowText} type="backgroundElement">
                  <ThemedText type="smallBold">{item.title}</ThemedText>
                  {item.price ? <ThemedText type="small">{item.price}</ThemedText> : null}
                </ThemedView>
              </ThemedView>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.two, borderRadius: Spacing.three },
  thumb: { width: 64, height: 64, borderRadius: Spacing.two },
  rowText: { flex: 1, gap: Spacing.one },
});
