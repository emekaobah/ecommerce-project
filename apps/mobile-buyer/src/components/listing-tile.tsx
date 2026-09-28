import { listingPrice } from '@oja/domain';
import { Text, useTheme } from '@oja/ui';
import { Image } from 'expo-image';
import { Pressable, StyleSheet } from 'react-native';

import type { Listing } from '@/api/listings';
import { openListing } from '@/navigation';

import { Price } from './price';

export const LISTING_TILE_SIZE = 140;

/** One shop's product in a horizontal shelf: photo on a neutral tile, name and the shop's price. */
export function ListingTile({ listing, currencyCode }: Readonly<{ listing: Listing; currencyCode: string }>) {
  const theme = useTheme();
  const price = listingPrice(listing.offers);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => openListing(listing)}
      style={({ pressed }) => [{ width: LISTING_TILE_SIZE, gap: theme.space.xs }, pressed && styles.pressed]}>
      <Image
        source={listing.product.thumbnail}
        contentFit="contain"
        style={{
          width: LISTING_TILE_SIZE,
          height: LISTING_TILE_SIZE,
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.md,
        }}
      />
      <Text variant="caption" numberOfLines={2}>
        {listing.product.title}
      </Text>
      {price ? <Price price={price} currencyCode={currencyCode} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
});
