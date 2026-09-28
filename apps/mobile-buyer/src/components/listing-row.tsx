import { listingPrice } from '@oja/domain';
import { ListRow, useTheme } from '@oja/ui';
import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';

import type { Listing } from '@/api/listings';
import { openListing } from '@/navigation';

import { Price } from './price';

/** One shop's product in a list: thumbnail on a neutral tile, name, the shop's price. */
export function ListingRow({
  listing,
  currencyCode,
  showShop = false,
}: Readonly<{ listing: Listing; currencyCode: string; showShop?: boolean }>) {
  const theme = useTheme();
  const price = listingPrice(listing.offers);
  return (
    <ListRow
      title={listing.product.title}
      subtitle={showShop ? listing.seller.name : undefined}
      onPress={() => openListing(listing)}
      trailing={price ? <Price price={price} currencyCode={currencyCode} /> : null}
      leading={
        listing.product.thumbnail ? (
          <Image
            source={listing.product.thumbnail}
            contentFit="contain"
            style={[styles.thumb, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm }]}
          />
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  thumb: { width: 64, height: 64 },
});
