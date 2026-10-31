import { useAuth } from '@clerk/expo';
import { bySize, deliveryEstimate, formatMoney, formatWeight, isSaved, listingPrice, offerPrice, shipsIn } from '@oja/domain';
import {
  EmptyState,
  ErrorState,
  FactTile,
  Icon,
  type IconName,
  InlineNote,
  NoTopScrollEdge,
  PhotoTile,
  PressableSurface,
  productScrollPosition,
  ProductRail,
  QuantityStepper,
  ShopMark,
  Skeleton,
  StickyAction,
  type StickyActionProps,
  Text,
  useTheme,
  useToast,
  useTopBand,
} from '@oja/ui';
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { FlatList, Linking, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAddToCart, useCart, useSetCartItemQuantity } from '@/api/cart';
import { isNotFound } from '@/api/errors';
import { useDeliveryEstimate, useListing, useListings, type ListingDetail } from '@/api/listings';
import { useToggleWishlist, useWishlist } from '@/api/wishlist';
import { useCartSession } from '@/cart/cart-provider';
import { DealBadges } from '@/components/deal-badge';
import { ListingTile } from '@/components/listing-tile';
import { PerishableNotice } from '@/components/perishable';
import { Price } from '@/components/price';
import { ReviewsPreview } from '@/components/reviews';
import { ShopStars } from '@/components/shop-facts';
import { ShopStatusBadge } from '@/components/shop-status';
import { openCartSheet, openShop } from '@/navigation';
import { useRegion } from '@/region/region-provider';

type Offer = ListingDetail['offers'][number];

/** The photo's height over the screen's width, as the catalogue draws it (250 of 282). */
const HERO_ASPECT = 250 / 282;

/**
 * A product in one shop's context: that shop's price and ship time, never another shop's.
 * Without a shop there is nothing to show (docs/design.md).
 */
export function ProductScreen({ sellerId, productId }: Readonly<{ sellerId?: string; productId: string }>) {
  if (!sellerId) {
    return (
      <EmptyState
        title="Pick a shop"
        body="Open this product from a shop's listing."
        secondaryAction={{ label: 'Back to shops near you', onPress: () => router.navigate('/') }}
      />
    );
  }
  return <ShopProduct sellerId={sellerId} productId={productId} />;
}

function ShopProduct({ sellerId, productId }: Readonly<{ sellerId: string; productId: string }>) {
  const theme = useTheme();
  const region = useRegion();
  const listing = useListing(region.region?.id, sellerId, productId);
  const [chosenId, setChosenId] = useState<string | undefined>(undefined);
  const scroll = useProductScroll();

  if (region.error) {
    return (
      <ErrorState
        title="Couldn't reach the store"
        body="Check your connection and try again. Anything in your cart is saved."
        error={region.error}
        onRetry={region.retry}
      />
    );
  }
  if (listing.error) {
    if (isNotFound(listing.error)) {
      return (
        <EmptyState
          title="No longer available"
          body="This shop isn't selling this product right now."
          icon="store"
          secondaryAction={{ label: 'Back to shops near you', onPress: () => router.navigate('/') }}
        />
      );
    }
    return (
      <ErrorState
        title="Couldn't load this product"
        body="Check your connection and try again. Anything in your cart is saved."
        error={listing.error}
        onRetry={() => void listing.refetch()}
      />
    );
  }

  const hideHeader = <Stack.Screen options={{ headerShown: false }} />;
  if (!region.region || !listing.data) {
    return (
      <View style={[styles.fill, { backgroundColor: theme.colors.bg }]}>
        {hideHeader}
        <ProductSkeleton scroll={scroll} />
        <ProductBar scroll={scroll} />
        <StickyAction label="Add to cart" price="—" disabled onPress={() => undefined} />
      </View>
    );
  }

  const { offers, seller, product } = listing.data;
  const currencyCode = region.region.currency_code;
  // Starts on the shop's cheapest variant, matching the "from" price in the feed.
  const selected = offers.find((o) => o.id === chosenId) ?? offers.find((o) => o.id === listingPrice(offers)?.offerId) ?? offers[0];
  const soldOut = selected?.available_quantity === 0;

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.bg }]}>
      {hideHeader}
      <PullEdge scroll={scroll} />
      <NoTopScrollEdge>
        <Animated.ScrollView
          {...scroll.band.scroll}
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={{ paddingBottom: theme.space[8] }}>
          <ParallaxPhoto scroll={scroll}>
            <Gallery images={product.images} dimmed={soldOut} height={scroll.galleryHeight} />
          </ParallaxPhoto>
          {/* The details slide over the photo: a straight top edge with a soft shadow, no rounded sheet. */}
          <View style={[styles.overPhoto, { backgroundColor: theme.colors.bg }, theme.elevation.overPhoto]}>
            <View style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[3], gap: theme.space[2] }}>
              <ShopLine seller={seller} />
              <Text variant="titleNamed" onLayout={scroll.onTitleLayout}>
                {product.title}
              </Text>
              {product.subtitle ? <Text tone="muted">{product.subtitle}</Text> : null}
              {selected ? <Price price={offerPrice(selected)} currencyCode={currencyCode} variant="titleNamed" /> : null}
              <DealBadges deals={listing.data.deals} all />
              {offers.length > 1 && selected ? <SizeChips offers={offers} selectedId={selected.id} onSelect={setChosenId} /> : null}
              <ShopStatusBadge status={seller.shop_status} withNote delivered />
              {soldOut ? (
                <SoldOutNote shop={seller.name} />
              ) : (
                <View style={[styles.row, { gap: theme.space[2] }]}>
                  <DeliveryFact listing={listing.data} offer={selected} currencyCode={currencyCode} />
                  <PickupFact pickup={seller.pickup} />
                </View>
              )}
              {product.perishable ? <PerishableNotice /> : null}
              {product.description ? (
                <Text style={{ lineHeight: theme.type.body.fontSize * 1.5, paddingTop: theme.space[1] }}>{product.description}</Text>
              ) : null}
            </View>
            <Details product={product} />
            <Section>
              <ReviewsPreview kind="product" id={productId} title={product.title} />
            </Section>
            <Attribution credits={product.attribution} />
            <MoreFromShop regionId={region.region.id} currencyCode={currencyCode} seller={seller} productId={productId} />
          </View>
        </Animated.ScrollView>
      </NoTopScrollEdge>
      <ProductBar
        scroll={scroll}
        title={product.title}
        save={<SaveButton sellerId={seller.id} productId={product.id} name={product.title} />}
      />
      {selected ? (
        <BuyBar offer={selected} name={product.title} currencyCode={currencyCode} orderable={seller.shop_status.orderable} />
      ) : null}
    </View>
  );
}

type ProductScroll = ReturnType<typeof useProductScroll>;

/**
 * The product screen's scroll, as the shop page tracks its own (`useTopBand`): the offset on the
 * UI thread, the fixed bar's foot, the photo's height under it, and the offset at which the big
 * title goes under the bar, measured once it lays out.
 */
function useProductScroll() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const band = useTopBand();
  const reduceMotion = useReducedMotion();
  const titleUnder = useSharedValue(0);
  const barBottom = insets.top + theme.hitArea;
  const galleryHeight = Math.round(width * HERO_ASPECT);
  // From the screen's top edge: the photo tile runs up under the bar and the status bar.
  const photoHeight = barBottom + galleryHeight;
  // The title sits in the details' first block, which starts where the photo ends.
  const onTitleLayout = (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    titleUnder.set(photoHeight + y + height - barBottom);
  };
  return { band, scrollY: band.scrollY, titleUnder, barBottom, galleryHeight, photoHeight, reduceMotion, onTitleLayout };
}

/** A worklet giving where the photo and bar stand at this frame's offset, for animated styles and reactions. */
function positionWorklet({ scrollY, titleUnder, photoHeight, reduceMotion }: ProductScroll) {
  return () => {
    'worklet';
    return productScrollPosition(scrollY.get(), { photoHeight, titleUnder: titleUnder.get(), reduceMotion });
  };
}

/**
 * The bar fixed over the top, never replaced. At the top it is the photo tile's colour, so it
 * reads as part of the photo: back, and save when given, with no title. Once the big title has gone
 * under it, the title shows small, the bar takes the page colour and a hairline appears beneath;
 * scrolling back up reverses it. It runs up behind the status bar.
 */
function ProductBar({ scroll, title, save }: Readonly<{ scroll: ProductScroll; title?: string; save?: ReactNode }>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const position = positionWorklet(scroll);
  const titled = useSharedValue(0);
  const { productTile, bg } = theme.colors;
  const fade = theme.motion.crossFade;

  // The bar changes once per crossing, cross-fading, not with every frame.
  useAnimatedReaction(
    () => position().titled,
    (now, before) => {
      if (now !== before) titled.set(withTiming(now ? 1 : 0, { duration: fade }));
    }
  );
  const bar = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(titled.get(), [0, 1], [productTile, bg]) }));
  const shown = useAnimatedStyle(() => ({ opacity: titled.get() }));

  return (
    <Animated.View style={[styles.bar, { paddingTop: insets.top, paddingHorizontal: theme.space[1] }, bar]}>
      <View style={[styles.row, { height: theme.hitArea, gap: theme.space[1] }]}>
        <BarButton icon="back" label="Back" onPress={() => router.back()} />
        {/* The big title is what a screen reader reads; this is its echo for the eye. */}
        <Animated.View style={[styles.fill, shown]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {title ? (
            <Text weight="bold" numberOfLines={1} style={styles.centredText}>
              {title}
            </Text>
          ) : null}
        </Animated.View>
        <View style={{ minWidth: theme.hitArea }}>{save}</View>
      </View>
      <Animated.View style={[styles.hairline, { backgroundColor: theme.colors.line }, shown]} />
    </Animated.View>
  );
}

/** A bare icon button in the bar: back, save. */
function BarButton({
  icon,
  label,
  onPress,
  selected,
}: Readonly<{ icon: IconName; label: string; onPress: () => void; selected?: boolean }>) {
  const theme = useTheme();
  return (
    <PressableSurface
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={onPress}
      style={[styles.center, { width: theme.hitArea, height: theme.hitArea, borderRadius: theme.radius.md }]}>
      <Icon name={icon} color={selected ? theme.colors.dangerText : theme.colors.ink} filled={selected} />
    </PressableSurface>
  );
}

/**
 * The photo tile's colour above the photo's top edge, followed down when the page is pulled, so
 * the photo never shows a gap above it, even under Reduce Motion when it doesn't stretch.
 */
function PullEdge({ scroll }: Readonly<{ scroll: ProductScroll }>) {
  const theme = useTheme();
  const { height } = useWindowDimensions();
  const { scrollY } = scroll;
  const pull = useAnimatedStyle(() => ({ transform: [{ translateY: Math.max(0, -scrollY.get()) }] }));
  return (
    <Animated.View
      style={[styles.edge, { top: 1 - height, height, backgroundColor: theme.colors.productTile }, pull]}
    />
  );
}

/**
 * The photo as the first thing in the scroll view, running up under the bar. It moves at about
 * half speed and dims slightly as the details slide over it, and stretches when pulled down, all
 * on the UI thread; under Reduce Motion it scrolls with the page. Straight corners.
 */
function ParallaxPhoto({ scroll, children }: Readonly<{ scroll: ProductScroll; children: ReactNode }>) {
  const theme = useTheme();
  const position = positionWorklet(scroll);
  const moved = useAnimatedStyle(() => {
    const { translateY, scale } = position();
    return { transform: [{ translateY }, { scale }] };
  });
  const veil = useAnimatedStyle(() => ({ opacity: position().dim }));
  return (
    <Animated.View
      style={[{ height: scroll.photoHeight, paddingTop: scroll.barBottom, backgroundColor: theme.colors.productTile }, moved]}>
      {children}
      <Animated.View style={[StyleSheet.absoluteFill, styles.veil, { backgroundColor: theme.colors.veil }, veil]} />
    </Animated.View>
  );
}

/** Every photo, swiped sideways on its tile (white, charcoal in dark) with dots for position. */
function Gallery({ images, dimmed, height }: Readonly<{ images: ListingDetail['product']['images']; dimmed: boolean; height: number }>) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  return (
    <PhotoTile style={{ height }}>
      <FlatList
        horizontal
        pagingEnabled
        data={images}
        keyExtractor={(image) => image.id}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) => setPage(Math.round(event.nativeEvent.contentOffset.x / width))}
        renderItem={({ item, index }) => (
          // Contained with a 10% margin, never cropped (tile rules).
          <View style={{ width, height, padding: '10%' }}>
            <Image
              source={item.url}
              contentFit="contain"
              accessibilityLabel={`Photo ${index + 1} of ${images.length}`}
              accessibilityIgnoresInvertColors
              style={[styles.fill, dimmed && styles.dimmed]}
            />
          </View>
        )}
        ListEmptyComponent={
          <View style={[styles.center, { width, height }]}>
            <Icon name="bag" color={theme.colors.muted} />
          </View>
        }
      />
      {images.length > 1 ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.dots, { bottom: theme.space[3], gap: theme.space[2] }]}>
          {images.map((image, i) => (
            <View
              key={image.id}
              style={{
                width: i === page ? theme.space[4] : theme.space[2],
                height: theme.space[2],
                borderRadius: theme.radius.pill,
                backgroundColor: i === page ? theme.colors.accent : theme.colors.photoDot,
              }}
            />
          ))}
        </View>
      ) : null}
    </PhotoTile>
  );
}

/** "IB Iya Bisi Foodstuff · ★ 4.8 (212)": the shop selling it, which opens its page. */
function ShopLine({ seller }: Readonly<{ seller: ListingDetail['seller'] }>) {
  const theme = useTheme();
  return (
    <PressableSurface
      accessibilityRole="link"
      accessibilityHint="Opens the shop"
      onPress={() => openShop(seller)}
      style={[styles.row, styles.start, { minHeight: theme.hitArea, gap: theme.space[2] }]}>
      <ShopMark name={seller.name} logoUrl={seller.logo} size="sm" />
      <Text variant="meta" weight="bold" tone="link">
        {seller.name}
      </Text>
      <ShopStars sellerId={seller.id} />
    </PressableSurface>
  );
}

/** One chip per size this shop offers, small to large; the price and the button follow the choice. */
function SizeChips({ offers, selectedId, onSelect }: Readonly<{ offers: Offer[]; selectedId: string; onSelect: (id: string) => void }>) {
  const theme = useTheme();
  const height = theme.space[8];
  const slop = Math.max(0, (theme.hitArea - height) / 2);
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Size" style={[styles.row, styles.wrap, { gap: theme.space[2], paddingVertical: theme.space[1] }]}>
      {bySize(offers).map((offer) => {
        const on = offer.id === selectedId;
        return (
          <PressableSurface
            key={offer.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            hitSlop={{ top: slop, bottom: slop }}
            onPress={() => onSelect(offer.id)}
            style={[
              styles.center,
              {
                minHeight: height,
                paddingHorizontal: theme.space[4],
                borderRadius: theme.radius.pill,
                backgroundColor: on ? theme.colors.primary : theme.colors.tile,
              },
            ]}>
            <Text weight="bold" style={{ color: on ? theme.colors.onPrimary : theme.colors.ink }}>
              {offer.variant_title ?? 'Default'}
            </Text>
          </PressableSurface>
        );
      })}
    </View>
  );
}

/**
 * When it would arrive: the best-value courier's date and fee to the address in "Delivering to",
 * for the size chosen (#23); without an address, or until that loads, the shop's dispatch time.
 */
function DeliveryFact({ listing, offer, currencyCode }: Readonly<{ listing: ListingDetail; offer?: Offer; currencyCode: string }>) {
  const { userId } = useAuth();
  const { region } = useRegion();
  const { data: estimate } = useDeliveryEstimate(region?.id, listing.seller.id, listing.product.id, {
    userId,
    variantId: offer?.variant_id,
  });
  if (estimate) {
    return (
      <FactTile
        icon="truck"
        value={deliveryEstimate(estimate.delivery_eta_time, new Date(), estimate.time_zone)}
        label={`${formatMoney(estimate.amount, currencyCode)} delivery`}
      />
    );
  }
  if (listing.leadtime_to_ship == null) return null;
  return <FactTile icon="truck" value={shipsIn(listing.leadtime_to_ship)} label="Delivery" />;
}

/** "Pick up · Surulere · free", beside delivery, only when the shop has a collection point (#94). */
function PickupFact({ pickup }: Readonly<{ pickup: ListingDetail['seller']['pickup'] }>) {
  if (!pickup) return null;
  return <FactTile icon="store" value="Pick up" label={pickup.area ? `${pickup.area} · free` : 'Free'} />;
}

function SoldOutNote({ shop }: Readonly<{ shop: string }>) {
  const theme = useTheme();
  return (
    <View
      accessible
      style={[styles.row, { gap: theme.space[2], padding: theme.space[2], borderRadius: theme.radius.md, backgroundColor: theme.colors.tile }]}>
      <Icon name="info" use="chip" color={theme.colors.accent} />
      <Text variant="meta" tone="muted" style={styles.fill}>
        <Text variant="meta" weight="bold" tone="muted">{`Sold out at ${shop}.`}</Text>
        {' Save it to see it back in stock in your saved items.'}
      </Text>
    </View>
  );
}

/**
 * The sticky buy bar. Quantity sits beside Add and stops at what's in stock, and Add's price
 * follows it. Once the size is in the cart, the bar shows that line's quantity and changes it
 * there, so a second tap never adds a duplicate line. Sold out, or a shop not taking orders
 * (ADR 0004), disables Add, and the in-cart quantity with it.
 */
function BuyBar({ offer, name, currencyCode, orderable }: Readonly<{ offer: Offer; name: string; currencyCode: string; orderable: boolean }>) {
  const toast = useToast();
  const { cartId, cartIdForAdding } = useCartSession();
  const cart = useCart(cartId);
  const add = useAddToCart(cartIdForAdding);
  const setLineQuantity = useSetCartItemQuantity(cartId ?? '');
  const [quantity, setQuantity] = useState(1);
  const line = cart.data?.sellers.flatMap((group) => group.items).find((item) => item.offer_id === offer.id);
  const unit = offerPrice(offer).amount;

  if (offer.available_quantity === 0) {
    return <StickyAction label="Sold out" disabled onPress={() => undefined} />;
  }

  if (line) {
    return (
      <BarWithNote
        label="In cart · View cart"
        variant="secondary"
        tone="accent"
        // A sheet over the product, so closing it comes back here, scrolled where it was.
        onPress={openCartSheet}
        leading={
          <QuantityStepper
            value={line.quantity}
            available={offer.available_quantity}
            name={name}
            min={0}
            // A shop not taking orders keeps what's in the cart as it is; the cart can still remove it.
            disabled={setLineQuantity.isPending || !orderable}
            onChange={(next) => setLineQuantity.mutate({ itemId: line.id, quantity: next })}
          />
        }
        note={setLineQuantity.error ? "Couldn't change the quantity. Try again." : null}
      />
    );
  }

  return (
    <BarWithNote
      label="Add"
      price={formatMoney(unit * quantity, currencyCode)}
      loading={add.isPending}
      // Until the cart is known, adding could start a second one.
      disabled={cartId === undefined || !orderable}
      // The toast confirms the add without leaving the page; the bar has switched to the cart's quantity.
      onPress={() =>
        add.mutate(
          { offerId: offer.id, quantity },
          { onSuccess: () => toast({ message: 'Added to your cart', action: { label: 'View cart', onPress: openCartSheet } }) }
        )
      }
      note={add.error ? `Couldn't add ${name} to your cart. Try again.` : null}
      leading={
        <QuantityStepper
          value={quantity}
          available={offer.available_quantity}
          name={name}
          disabled={!orderable}
          onChange={setQuantity}
        />
      }
    />
  );
}

/** The sticky action with what went wrong just above it, in the ember note (State rules: inline problems). */
function BarWithNote({ note, ...action }: Readonly<StickyActionProps & { note: string | null }>) {
  const theme = useTheme();
  return (
    <View style={{ backgroundColor: theme.colors.bg }}>
      {note ? (
        <View style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[2] }}>
          <InlineNote>{note}</InlineNote>
        </View>
      ) : null}
      <StickyAction {...action} />
    </View>
  );
}

/** The heart in the bar: saves the product from this shop; a guest is sent to sign in first. */
function SaveButton({ sellerId, productId, name }: Readonly<{ sellerId: string; productId: string; name: string }>) {
  const toast = useToast();
  const { isSignedIn, userId } = useAuth();
  const { region } = useRegion();
  const wishlist = useWishlist(isSignedIn ? userId : null, region?.id);
  const toggle = useToggleWishlist();
  const saved = isSaved(wishlist.data ?? [], sellerId, productId);

  if (!isSignedIn) return <BarButton icon="heart" label={`Save ${name}`} onPress={() => router.push('/sign-in')} />;
  return (
    <BarButton
      icon="heart"
      label={saved ? `Remove ${name} from saved` : `Save ${name}`}
      selected={saved}
      onPress={() => {
        // Until the wishlist loads, it isn't known which way the toggle goes.
        if (!wishlist.data || toggle.isPending) return;
        toggle.mutate(
          { sellerId, productId, save: !saved },
          { onError: () => toast({ message: "Couldn't update your saved items. Try again.", tone: 'problem' }) }
        );
      }}
    />
  );
}

function Section({ title, children }: Readonly<{ title?: string; children: ReactNode }>) {
  const theme = useTheme();
  return (
    <View style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[6], gap: theme.space[3] }}>
      {title ? <Text variant="heading">{title}</Text> : null}
      {children}
    </View>
  );
}

/** The category's attributes and the weight, as label and value. */
function Details({ product }: Readonly<{ product: ListingDetail['product'] }>) {
  const theme = useTheme();
  const rows = [
    ...product.attributes.map((a) => ({ label: a.name, value: a.values.join(', ') })),
    ...(product.weight ? [{ label: 'Weight', value: formatWeight(product.weight) }] : []),
  ];
  if (!rows.length) return null;
  return (
    <Section title="Details">
      <View style={{ gap: theme.space[2] }}>
        {rows.map((row) => (
          <View key={row.label} accessible style={[styles.row, { gap: theme.space[3] }]}>
            <Text tone="muted" style={{ width: theme.block.railTile * 0.85 }}>
              {row.label}
            </Text>
            <Text weight="semibold" style={styles.fill}>
              {row.value}
            </Text>
          </View>
        ))}
      </View>
    </Section>
  );
}

/** Credits for product data taken from databases whose licence requires it (e.g. Open Food Facts). */
function Attribution({ credits }: Readonly<{ credits: ListingDetail['product']['attribution'] }>) {
  const theme = useTheme();
  if (!credits.length) return null;
  return (
    <Section>
      {credits.map((credit) => (
        <PressableSurface
          key={credit.name}
          accessibilityRole="link"
          accessibilityHint="Opens the source in your browser"
          onPress={() => void Linking.openURL(credit.url)}
          style={{ minHeight: theme.hitArea, justifyContent: 'center' }}>
          <Text variant="meta" tone="muted">
            Product information from{' '}
            <Text variant="meta" weight="bold" tone="accent">
              {credit.name}
            </Text>{' '}
            ({credit.license})
          </Text>
        </PressableSurface>
      ))}
    </Section>
  );
}

/** Other products from the same shop as small cards; left out when there are none. */
function MoreFromShop({
  regionId,
  currencyCode,
  seller,
  productId,
}: Readonly<{ regionId: string; currencyCode: string; seller: ListingDetail['seller']; productId: string }>) {
  const theme = useTheme();
  const suggestions = useListings(regionId, { sellerId: seller.id, excludeProductId: productId, limit: 10 });
  // Nothing else from this shop, or it won't load: leave the section out rather than show an empty rail.
  if (suggestions.error || suggestions.data?.length === 0) return null;
  const tile = theme.block.railTile;
  return (
    <View style={{ paddingTop: theme.space[6], gap: theme.space[3] }}>
      <Text variant="heading" style={{ paddingHorizontal: theme.space[4] }}>
        More from {seller.name}
      </Text>
      {suggestions.data ? (
        <ProductRail label={`More from ${seller.name}`}>
          {suggestions.data.map((listing) => (
            <ListingTile key={listing.product.id} listing={listing} seller={listing.seller} currencyCode={currencyCode} />
          ))}
        </ProductRail>
      ) : (
        <View style={[styles.row, { gap: theme.space[3], paddingHorizontal: theme.space[4] }]}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width={tile} height={tile} radius="md" />
          ))}
        </View>
      )}
    </View>
  );
}

/** The photo, name, price and facts in their shapes, under the bar, whose back works straight away. */
function ProductSkeleton({ scroll }: Readonly<{ scroll: ProductScroll }>) {
  const theme = useTheme();
  return (
    <View accessible accessibilityLabel="Loading product">
      <View style={{ paddingTop: scroll.barBottom, backgroundColor: theme.colors.productTile }}>
        <Skeleton height={scroll.galleryHeight} style={styles.straight} />
      </View>
      <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
        <Skeleton width="45%" height={theme.space[3]} />
        <Skeleton width="80%" height={theme.space[6]} />
        <Skeleton width="35%" height={theme.space[6]} />
        <View style={[styles.row, { gap: theme.space[2] }]}>
          <Skeleton height={theme.space[12] + theme.space[4]} radius="md" style={styles.fill} />
          <Skeleton height={theme.space[12] + theme.space[4]} radius="md" style={styles.fill} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexWrap: 'wrap' },
  start: { alignSelf: 'flex-start' },
  center: { alignItems: 'center', justifyContent: 'center' },
  straight: { borderRadius: 0 },
  centredText: { textAlign: 'center' },
  bar: { position: 'absolute', top: 0, left: 0, right: 0 },
  hairline: { height: StyleSheet.hairlineWidth },
  edge: { position: 'absolute', left: 0, right: 0, pointerEvents: 'none' },
  // Drawn after the photo, so it passes over the photo as the photo is held back.
  overPhoto: { zIndex: 1 },
  veil: { pointerEvents: 'none' },
  dots: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center' },
  dimmed: { opacity: 0.55 },
});
