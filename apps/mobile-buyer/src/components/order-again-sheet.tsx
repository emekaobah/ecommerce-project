import { useAuth } from '@clerk/expo';
import { ClientError } from '@oja/api-client';
import {
  distanceLabel,
  formatMoney,
  itemsLabel,
  orderAgainBasket,
  orderAgainClosedNote,
  orderAgainLines,
  orderLineName,
  shopStatusChip,
  type OrderAgainLine,
} from '@oja/domain';
import { Button, haptics, Icon, MAX_FONT_SCALE, InlineNote, PressableSurface, Skeleton, StatusChip, Text, useTheme, useToast } from '@oja/ui';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAddOfferLines } from '@/api/cart';
import { useFailureMessage } from '@/api/errors';
import { useOrderAgain, type OrderAgain } from '@/api/orders';
import { useShop } from '@/api/shops';
import { useCartSession } from '@/cart/cart-provider';
import { useDeliveringTo } from '@/delivering-to/delivering-to-provider';
import { useRegion } from '@/region/region-provider';

import { SheetModal } from './sheet-modal';

type OrderAgainSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** The checkout (order group) the shops' orders are part of. */
  groupId: string;
  /** The shops to order from again: one shop's order, or every shop of a checkout across shops. */
  shops: readonly { id: string; name: string }[];
  /** The orders' currency, which today's prices are in too: the order's region. */
  currency: string;
};

/**
 * Order again (#86, catalogue b-after #4): a received order at today's prices, every line ticked
 * except what can't be had now, with a changed price or short stock called out. A checkout
 * across shops lists each shop's lines under its name. Adds the ticked lines to the cart in one
 * go; delivery is still chosen at checkout. A shop that takes no orders now says why, and its
 * lines can't be ticked; with none taking orders there is no button.
 */
export function OrderAgainSheet({ visible, onClose, groupId, shops, currency }: Readonly<OrderAgainSheetProps>) {
  return (
    <SheetModal visible={visible} onClose={onClose}>
      {visible ? <OrderAgainContent onClose={onClose} groupId={groupId} shops={shops} currency={currency} /> : null}
    </SheetModal>
  );
}

/** The text size (as a scale of the default) from which a line's total goes under its name. */
const LARGE_TEXT = 1.3;

/** The sheet's lines take at most this share of the screen's height, then scroll. */
const LINES_MAX_SHARE = 0.5;

function OrderAgainContent({ onClose, groupId, shops, currency }: Readonly<Omit<OrderAgainSheetProps, 'visible'>>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { userId } = useAuth();
  const previews = useOrderAgain(
    userId,
    groupId,
    shops.map((shop) => shop.id),
  );
  const data = previews.data;

  let body;
  if (previews.error && !data) {
    body = <LoadError onRetry={previews.refetch} />;
  } else if (!data) {
    body = <LinesSkeleton />;
  } else {
    body = <Preview previews={data} currency={currency} onAdded={onClose} onRefused={previews.refetch} linesMaxHeight={height * LINES_MAX_SHARE} />;
  }

  const title = shops.length === 1 ? `Order again from ${data?.[0]?.seller.name ?? shops[0]?.name}` : `Order again from ${shops.length} shops`;
  return (
    <View
      style={{
        // The catalogue's sheet sets the title 8 under the grabber, and everything 8 apart.
        paddingTop: theme.space[2],
        paddingHorizontal: theme.space[4],
        paddingBottom: Math.max(insets.bottom, theme.space[4]),
        gap: theme.space[2],
      }}>
      <Text variant="titlePushed" accessibilityRole="header">
        {title}
      </Text>
      {body}
    </View>
  );
}

type PreviewProps = {
  /** One preview per shop, in the checkout's order. */
  previews: readonly OrderAgain[];
  currency: string;
  onAdded: () => void;
  /** The cart refused (a shop stopped taking orders, stock moved): the previews are fetched again. */
  onRefused: () => void;
  linesMaxHeight: number;
};

function Preview({ previews, currency, onAdded, onRefused, linesMaxHeight }: Readonly<PreviewProps>) {
  const theme = useTheme();
  const toast = useToast();
  const { cartIdForAdding } = useCartSession();
  const add = useAddOfferLines(cartIdForAdding);
  const shops = previews.map((preview) => ({ preview, lines: orderAgainLines(preview.items, currency), takingOrders: !preview.not_taking_orders }));
  // Every line that can be added starts ticked; the buyer unticks what they don't want.
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const { ticked, summary, takingOrders } = orderAgainBasket(shops, unticked);
  // The cart refused the lines (400): a shop stopped taking orders, or stock moved. The previews
  // are fetched again, so the sheet shows what can be had now.
  const failure = useFailureMessage(add.error, "Couldn't add these to your cart. Check your connection and try again.", {
    400: 'Something changed at the shop since. Check the lines and try again.',
  });

  const toggle = (id: string) => {
    haptics.selection();
    setUnticked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addToCart = () => {
    const items = shops.flatMap(({ lines }) =>
      lines.flatMap((line) => (line.addable && line.offerId && ticked.has(line.id) ? [{ offer_id: line.offerId, quantity: line.quantity }] : []))
    );
    add.mutate(items, {
      onSuccess: () => {
        haptics.success();
        onAdded();
        toast({
          message: `${itemsLabel(summary.count)} added`,
          action: { label: 'View cart', onPress: () => router.navigate('/cart') },
        });
      },
      onError: (error) => {
        if (error instanceof ClientError && error.status === 400) onRefused();
      },
    });
  };

  const linesOf = ({ preview, lines, takingOrders: shopTakes }: (typeof shops)[number]) => {
    const items = new Map(preview.items.map((item) => [item.id, item]));
    return lines.map((line) => {
      const item = items.get(line.id);
      return item ? (
        <Line
          key={line.id}
          name={orderLineName(item)}
          thumbnail={item.thumbnail}
          line={line}
          currency={currency}
          ticked={ticked.has(line.id)}
          onToggle={() => toggle(line.id)}
          disabled={!shopTakes}
        />
      ) : null;
    });
  };
  const scroll = (children: ReactNode) => (
    <ScrollView style={{ maxHeight: linesMaxHeight }} contentContainerStyle={{ gap: theme.space[2], paddingVertical: theme.space[1] }}>
      {children}
    </ScrollView>
  );
  const only = shops.length === 1 ? shops[0] : undefined;

  return (
    <>
      {only ? (
        <>
          <ShopLine preview={only.preview} />
          <ShopNote preview={only.preview} where="above" />
          {only.lines.length ? scroll(linesOf(only)) : null}
          <ShopNote preview={only.preview} where="below" />
        </>
      ) : (
        scroll(
          shops.map((shop) => (
            <View key={shop.preview.seller.id} style={{ gap: theme.space[2], paddingBottom: theme.space[2] }}>
              <Text variant="heading" accessibilityRole="header">
                {shop.preview.seller.name}
              </Text>
              <ShopLine preview={shop.preview} />
              <ShopNote preview={shop.preview} where="above" />
              {linesOf(shop)}
              <ShopNote preview={shop.preview} where="below" />
            </View>
          ))
        )
      )}
      {takingOrders ? (
        <View style={{ gap: theme.space[2], marginTop: theme.space[1] }}>
          {failure ? <InlineNote>{failure}</InlineNote> : null}
          <Button
            label={summary.label}
            detail={summary.count ? formatMoney(summary.total, currency) : undefined}
            size="main"
            disabled={!summary.count}
            loading={add.isPending}
            onPress={addToCart}
          />
        </View>
      ) : null}
    </>
  );
}

/**
 * What the sheet says of a shop that isn't open: above its lines while it still takes orders
 * ("Prepared when it opens 10am Mon"), below them as a note when it takes none.
 */
function ShopNote({ preview, where }: Readonly<{ preview: OrderAgain; where: 'above' | 'below' }>) {
  const note = orderAgainClosedNote(preview);
  const takesOrders = !preview.not_taking_orders;
  if (!note || (where === 'above') !== takesOrders) return null;
  return where === 'above' ? (
    <Text variant="meta" tone="muted">
      {note}
    </Text>
  ) : (
    <InlineNote>{note}</InlineNote>
  );
}

/**
 * Under the title: "● Open · closes 7pm · 1 km from 14 Bode Thomas St", the grey chip while
 * closed; the distance only when the buyer has an address and the shop serves their region.
 */
function ShopLine({ preview }: Readonly<{ preview: OrderAgain }>) {
  const theme = useTheme();
  const { region } = useRegion();
  const { address } = useDeliveringTo();
  const shop = useShop(region?.id, preview.seller.id);
  const fontScale = Math.min(useWindowDimensions().fontScale, MAX_FONT_SCALE);
  const status = preview.shop_status;
  if (!status) return null;
  const km = shop.data?.distance_km;
  const distance = km != null && address ? `${distanceLabel(km)} from ${address.address_1}` : null;
  if (status.state !== 'open') {
    return (
      <View style={[styles.wrap, { gap: theme.space[1] }]}>
        <StatusChip {...shopStatusChip(status.state, status.label)} />
        {distance ? (
          <Text variant="meta" tone="muted">
            {distance}
          </Text>
        ) : null}
      </View>
    );
  }
  // The label reads "Open · closes 7pm"; "Open" takes the leaf colour and its dot.
  const rest = status.label.replace(/^Open/, '');
  return (
    <View
      accessible
      accessibilityLabel={[status.label, distance].filter(Boolean).join(', ')}
      style={[styles.top, { gap: theme.space[1] }]}>
      {/* Centred on the first line, however the line wraps. */}
      <View style={{ height: theme.type.meta.lineHeight * fontScale, justifyContent: 'center' }}>
        <View style={{ width: theme.space[2], height: theme.space[2], borderRadius: theme.radius.pill, backgroundColor: theme.colors.leafText }} />
      </View>
      <Text variant="meta" tone="muted" style={styles.shrink}>
        <Text variant="label" weight="extrabold" tone="leaf">
          Open
        </Text>
        {distance ? `${rest} · ${distance}` : rest}
      </Text>
    </View>
  );
}

type LineProps = {
  name: string;
  thumbnail: string | null;
  line: OrderAgainLine;
  currency: string;
  ticked: boolean;
  onToggle: () => void;
  /** The shop takes no orders now: the lines show, but nothing can be ticked. */
  disabled: boolean;
};

/** One item: its checkbox, photo, name, how many, what changed, and its total at today's price. */
function Line({ name, thumbnail, line, currency, ticked, onToggle, disabled }: Readonly<LineProps>) {
  const theme = useTheme();
  const thumb = theme.control.row;
  // At the largest text sizes the total goes under the name, so the name keeps the width to wrap in.
  const stacked = useWindowDimensions().fontScale >= LARGE_TEXT;
  const off = !line.addable;
  const total = line.total === null ? '—' : formatMoney(line.total, currency);
  const detail = line.addable ? `× ${line.quantity}` : line.note;
  const totalText = (
    <Text variant="heading" tabular style={{ fontSize: theme.type.body.fontSize }}>
      {total}
    </Text>
  );
  const spoken = [name, line.addable ? `${line.quantity}` : null, line.note, line.total === null ? null : total].filter(Boolean).join(', ');
  return (
    <PressableSurface
      accessibilityRole="checkbox"
      accessibilityLabel={spoken}
      accessibilityState={{ checked: ticked, disabled: off || disabled }}
      disabled={off || disabled}
      onPress={onToggle}
      ringInset
      style={[styles.row, { gap: theme.space[2], minHeight: theme.hitArea, opacity: off ? 0.55 : 1 }]}>
      <Checkbox ticked={ticked} />
      <View style={{ width: thumb, height: thumb, borderRadius: theme.radius.md, overflow: 'hidden', backgroundColor: theme.colors.productTile }}>
        {thumbnail ? <Image source={thumbnail} contentFit="contain" style={styles.fill} /> : null}
      </View>
      <View style={styles.fill}>
        <Text weight="bold">{name}</Text>
        <Text variant="meta" tone="muted">
          {detail}
        </Text>
        {line.addable && line.note ? (
          <Text variant="meta" weight="bold" style={{ color: theme.colors.emberText }}>
            {line.note}
          </Text>
        ) : null}
        {stacked ? totalText : null}
      </View>
      {stacked ? null : totalText}
    </PressableSurface>
  );
}

/** The catalogue's 22px checkbox: indigo with a white tick when ticked, an outline otherwise. */
function Checkbox({ ticked }: Readonly<{ ticked: boolean }>) {
  const theme = useTheme();
  const size = theme.space[6];
  return (
    <View
      style={[
        styles.centre,
        {
          width: size,
          height: size,
          borderRadius: theme.radius.sm,
          borderWidth: theme.line.input,
          borderColor: ticked ? theme.colors.primary : theme.colors.control,
          backgroundColor: ticked ? theme.colors.primary : 'transparent',
        },
      ]}>
      {ticked ? <Icon name="check" use="chip" color={theme.colors.onPrimary} /> : null}
    </View>
  );
}

function LoadError({ onRetry }: Readonly<{ onRetry: () => void }>) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[2] }}>
      <InlineNote>{"Couldn't load today's prices. Check your connection and try again."}</InlineNote>
      <Button label="Try again" variant="secondary" size="main" icon="refresh" onPress={onRetry} />
    </View>
  );
}

/** Loading: the status line and three lines in outline. */
function LinesSkeleton() {
  const theme = useTheme();
  const thumb = theme.control.row;
  return (
    <View accessible accessibilityLabel="Loading today's prices" style={{ gap: theme.space[2] }}>
      <Skeleton width="60%" height={theme.type.meta.lineHeight} radius="pill" />
      {[0, 1, 2].map((key) => (
        <View key={key} style={[styles.row, { gap: theme.space[2] }]}>
          <Skeleton width={theme.space[6]} height={theme.space[6]} radius="md" />
          <Skeleton width={thumb} height={thumb} radius="md" />
          <View style={[styles.fill, { gap: theme.space[1] }]}>
            <Skeleton width="70%" height={theme.type.body.lineHeight} radius="pill" />
            <Skeleton width="30%" height={theme.type.meta.lineHeight} radius="pill" />
          </View>
        </View>
      ))}
      <Skeleton height={theme.control.main} radius="pill" />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  top: { flexDirection: 'row', alignItems: 'flex-start' },
  wrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  shrink: { flexShrink: 1 },
  centre: { alignItems: 'center', justifyContent: 'center' },
});
