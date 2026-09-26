import { formatMoney, PRODUCT_NAME } from '@oja/domain';
import { EmptyState, ErrorState, ListRow, LoadingState, Text, useTheme } from '@oja/ui';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useProducts } from '@/api/products';
import { useRegion } from '@/region/region-provider';

export function HomeScreen() {
  const theme = useTheme();
  const region = useRegion();
  const products = useProducts(region.region?.id);

  const content = () => {
    if (region.error) {
      return <ErrorState title="Couldn't reach the store" message={region.error.message} onRetry={region.retry} />;
    }
    if (products.error) {
      return (
        <ErrorState
          title="Couldn't load products"
          message={products.error.message}
          onRetry={() => void products.refetch()}
        />
      );
    }
    if (!region.region || !products.data) return <LoadingState />;

    const { currency_code } = region.region;
    return (
      <FlatList
        data={products.data}
        keyExtractor={(p) => p.id}
        contentContainerStyle={products.data.length === 0 && styles.emptyList}
        ListEmptyComponent={<EmptyState title="No products yet" message="Check back soon." />}
        refreshing={products.isRefetching}
        onRefresh={() => void products.refetch()}
        renderItem={({ item }) => {
          const amount = item.variants?.[0]?.calculated_price?.calculated_amount;
          return (
            <ListRow
              title={item.title}
              subtitle={amount != null ? formatMoney(amount, currency_code) : undefined}
              onPress={() => router.push({ pathname: '/product/[id]', params: { id: item.id } })}
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
          );
        }}
      />
    );
  };

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.container, { backgroundColor: theme.colors.background, paddingHorizontal: theme.space.md }]}>
      <Text variant="title" style={{ marginVertical: theme.space.md }}>
        {PRODUCT_NAME}
      </Text>
      {content()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  emptyList: { flexGrow: 1 },
  thumb: { width: 64, height: 64 },
});
