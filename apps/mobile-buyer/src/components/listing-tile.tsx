import { dealLabel, formatMoney, listingPrice } from '@oja/domain';
import { ProductTile, useToast } from '@oja/ui';

import { useAddToCart } from '@/api/cart';
import type { Listing } from '@/api/listings';
import { useCartSession } from '@/cart/cart-provider';
import { openListing } from '@/navigation';

/** A shop's listing as a tile shows it; Home's shops carry their listings without the seller. */
type TileListing = Pick<Listing, 'product' | 'offers' | 'deals'>;
type TileSeller = Pick<Listing['seller'], 'id' | 'shop_status'>;

/** Sold out: the shop tracks stock on every size it offers and has none left. */
export const isSoldOut = (offers: TileListing['offers']) =>
  offers.length > 0 && offers.every((offer) => offer.available_quantity === 0);

/**
 * One shop's product as a tile in a rail or grid: its photo, the shop's price (a sale crossed
 * out), the shop's deal badge, and an add button that puts one in the cart. A product with more
 * than one size opens its page to choose; sold out, or a shop not taking orders, has no add button.
 */
export function ListingTile({
  listing,
  seller,
  currencyCode,
  detail,
}: Readonly<{ listing: TileListing; seller: TileSeller; currencyCode: string; detail?: string | null }>) {
  const { cartIdForAdding } = useCartSession();
  const add = useAddToCart(cartIdForAdding);
  const toast = useToast();
  const price = listingPrice(listing.offers);
  const open = () => openListing({ seller, product: listing.product });
  const [deal] = listing.deals;
  const name = listing.product.title;
  const only = listing.offers.length === 1 ? listing.offers[0] : undefined;

  const onAdd = () => {
    if (!only) return open();
    add.mutate(
      { offerId: only.id },
      {
        onSuccess: () => toast({ message: `${name} added to your cart`, tone: 'done' }),
        onError: () => toast({ message: `Couldn't add ${name} to your cart. Try again.`, tone: 'problem' }),
      }
    );
  };

  return (
    <ProductTile
      name={name}
      imageUrl={listing.product.thumbnail}
      price={price ? `${price.from ? 'From ' : ''}${formatMoney(price.amount, currencyCode)}` : ''}
      wasPrice={price?.compareAt == null ? null : formatMoney(price.compareAt, currencyCode)}
      deal={deal ? dealLabel(deal) : null}
      detail={detail}
      soldOut={isSoldOut(listing.offers)}
      closed={!seller.shop_status.orderable}
      onPress={open}
      onAdd={add.isPending ? undefined : onAdd}
    />
  );
}
