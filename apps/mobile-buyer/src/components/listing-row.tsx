import { listingPrice } from '@oja/domain';
import { ListRow, useTheme } from '@oja/ui';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import type { Listing } from '@/api/listings';
import { openListing } from '@/navigation';

import { DealBadges } from './deal-badge';
import { Price } from './price';

/** One shop's product in a list: thumbnail on a neutral tile, name, the shop's price and its deal. */
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
      trailing={
        price || listing.deals.length ? (
          <View style={[styles.trailing, { gap: theme.space[1] }]}>
            {price ? <Price price={price} currencyCode={currencyCode} /> : null}
            <DealBadges deals={listing.deals} />
          </View>
        ) : null
      }
      leading={
        listing.product.thumbnail ? (
          <Image
            source={listing.product.thumbnail}
            contentFit="contain"
            style={[styles.thumb, { backgroundColor: theme.colors.productTile, borderRadius: theme.radius.sm }]}
          />
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  thumb: { width: 64, height: 64 },
  trailing: { alignItems: 'flex-end', maxWidth: 160 },
});
