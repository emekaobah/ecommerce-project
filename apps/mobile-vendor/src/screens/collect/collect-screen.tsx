import { ApiError } from '@oja/api-client';
import {
  buyerShortName,
  isPickupCodeFormat,
  openingLabel,
  PICKUP_CODE_LENGTH,
  PICKUP_WRONG_CODE_MESSAGE,
  pickupLockoutMessage,
  pickupRefusal,
  type PickupRefusal,
} from '@oja/domain';
import { reportError } from '@oja/expo-sentry';
import {
  Band,
  Button,
  CodeBoxes,
  ErrorState,
  haptics,
  Icon,
  InlineNote,
  PhotoTile,
  QuantityPill,
  Skeleton,
  Text,
  TextField,
  TopBandScreen,
  useTheme,
  useTopBand,
} from '@oja/ui';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Image } from 'expo-image';
import { Stack, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCollectOrder, useOrder, type Order } from '@/api/orders';
import { useShopHours } from '@/api/shop-hours';
import { useNow } from '@/orders/use-now';
import { useSession } from '@/session/session-store';

import { ConfirmationHero } from './confirmation-hero';

/** Why the last Hand over was refused, from the API's answer; a failure without one is the connection's. */
const refusalOf = (error: unknown): PickupRefusal =>
  error instanceof ApiError ? pickupRefusal(error.status, error.body) : { kind: 'failed' };

/** The shop's time zone, for the times the counter reads; the phone's until the shop's hours load. */
function useShopTimeZone() {
  return useShopHours(useSession()?.sellerId).data?.time_zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Handing a pickup order over at the counter (#12), in one step (catalogue v-hand #3): check
 * the items, type who is collecting, enter the buyer's code or scan their QR, then Hand over
 * order, which checks the code and records the handover together. A wrong code hands nothing
 * over; after five in 15 minutes the counter waits until the API's `retry_at`. Once collected,
 * the indigo confirmation.
 */
export function CollectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrder(id);

  const content = () => {
    if (order.error && !order.data) {
      return (
        <ErrorState
          title="Couldn't load the order"
          body="Check your connection and try again. Nothing has been handed over."
          error={order.error}
          onRetry={() => void order.refetch()}
        />
      );
    }
    if (!order.data) return <CollectSkeleton />;
    if (order.data.fulfilment.collection) return <Collected order={order.data} />;
    return <Counter order={order.data} />;
  };

  return (
    <>
      {/* Once collected, the confirmation runs up under the status bar. */}
      <Stack.Screen
        options={{ title: order.data ? `Order #${order.data.display_id}` : 'Order', headerShown: !order.data?.fulfilment.collection }}
      />
      {content()}
    </>
  );
}

/** The band, an item and the two fields while the order loads. */
function CollectSkeleton() {
  const theme = useTheme();
  return (
    <View>
      <Band>
        <Text variant="titleNamed" tone="onBand">
          Hand over this order
        </Text>
      </Band>
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <Skeleton height={theme.control.md} />
        <Skeleton height={theme.hitArea} />
        <Skeleton height={theme.block.codeBox} />
      </View>
    </View>
  );
}

type Item = NonNullable<Order['items']>[number];

/** One of the order's lines: its photo, name and quantity, and at its end `trailing`. */
function Line({ item, trailing, spoken }: Readonly<{ item: Item; trailing?: ReactNode; spoken?: string }>) {
  const theme = useTheme();
  const photo = theme.control.md;
  const title = item.product_title ?? 'Item';
  return (
    <View accessible accessibilityLabel={[`${Number(item.quantity)} × ${title}`, spoken].filter(Boolean).join(', ')} style={[styles.row, { gap: theme.space[2] }]}>
      <PhotoTile style={{ width: photo, height: photo, borderRadius: theme.radius.md }}>
        {item.thumbnail ? <Image source={{ uri: item.thumbnail }} contentFit="contain" style={StyleSheet.absoluteFill} /> : null}
      </PhotoTile>
      <View style={styles.fill}>
        <Text weight="bold">{title}</Text>
        <Text variant="meta" tone="muted" tabular>{`× ${Number(item.quantity)}`}</Text>
      </View>
      {trailing}
    </View>
  );
}

/** The code's problem in words: the lockout with when to try again, or a wrong code. */
function problemMessage(refusal: PickupRefusal | null, locked: boolean, now: Date, timeZone: string): string | null {
  if (locked && refusal?.kind === 'locked') return pickupLockoutMessage(refusal.retryAt, now, timeZone);
  if (refusal?.kind === 'wrong_code') return PICKUP_WRONG_CODE_MESSAGE;
  return null;
}

function Counter({ order }: Readonly<{ order: Order }>) {
  const theme = useTheme();
  const collect = useCollectOrder(order.id);
  // The view measures itself below the header: without its height the keyboard covers the foot button.
  const headerHeight = useHeaderHeight();
  const timeZone = useShopTimeZone();
  const now = useNow(5_000);
  const [collectedBy, setCollectedBy] = useState('');
  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [refusal, setRefusal] = useState<PickupRefusal | null>(null);

  const locked = refusal?.kind === 'locked' && now.getTime() < Date.parse(refusal.retryAt);
  const message = problemMessage(refusal, locked, now, timeZone);
  const ready = collectedBy.trim() !== '' && isPickupCodeFormat(code) && !locked;

  // iOS has no live regions: the code's problem is announced as it appears. It sits under the
  // code, last but for the QR button: scrolled to, so the keyboard never hides it at large text.
  const scroll = useRef<ScrollViewInstance>(null);
  useEffect(() => {
    if (!message) return;
    scroll.current?.scrollToEnd({ animated: true });
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
  }, [message]);

  const handOver = () =>
    collect.mutate(
      { code, collectedBy: collectedBy.trim() },
      {
        onSuccess: () => haptics.success(),
        onError: (error) => {
          const next = refusalOf(error);
          if (next.kind === 'failed') reportError(error, "Couldn't hand the order over");
          else haptics.warning();
          setRefusal(next);
        },
      },
    );

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={headerHeight}>
      <ScrollView ref={scroll} contentContainerStyle={{ paddingBottom: theme.space[6] }} keyboardShouldPersistTaps="handled">
        <Band>
          <Text variant="titleNamed" tone="onBand">
            Hand over this order
          </Text>
        </Band>
        <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
          {(order.items ?? []).map((item) => (
            <Line key={item.id} item={item} />
          ))}
          <TextField
            label="Who is collecting?"
            testID="collected-by"
            value={collectedBy}
            onChangeText={setCollectedBy}
            autoCapitalize="words"
            autoCorrect={false}
            textContentType="name"
          />
          <View style={{ gap: theme.space[1] }}>
            <CodeBoxes
              label={`The buyer's ${PICKUP_CODE_LENGTH}-digit code`}
              value={code}
              length={PICKUP_CODE_LENGTH}
              error={refusal?.kind === 'wrong_code' || locked}
              disabled={locked}
              onChangeText={(next) => {
                setCode(next);
                if (refusal?.kind === 'wrong_code') setRefusal(null);
              }}
            />
            {message ? (
              <View accessible accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.row, { gap: theme.space[1] }]}>
                <Icon name="alert" use="chip" color={theme.colors.danger} />
                <Text variant="meta" weight="bold" tone="danger" style={styles.fill}>
                  {message}
                </Text>
              </View>
            ) : null}
          </View>
          <Button label="Scan their QR instead" variant="secondary" icon="scan" disabled={locked} onPress={() => setScanning(true)} />
        </View>
      </ScrollView>
      <SafeAreaView
        edges={['bottom']}
        style={{ paddingHorizontal: theme.space[3], paddingTop: theme.space[2], gap: theme.space[2], backgroundColor: theme.colors.bg }}>
        {refusal?.kind === 'failed' ? (
          <InlineNote>{"Couldn't hand the order over. Check your connection and try again; nothing was handed over."}</InlineNote>
        ) : null}
        {refusal?.kind === 'not_allowed' ? (
          <InlineNote>{"This order can't be handed over at the counter now. Go back to the order to see where it is."}</InlineNote>
        ) : null}
        <Button label="Hand over order" size="main" disabled={!ready} loading={collect.isPending} onPress={handOver} />
      </SafeAreaView>
      {scanning ? (
        <QrScanner
          onClose={() => setScanning(false)}
          onCode={(scanned) => {
            setCode(scanned);
            if (refusal?.kind === 'wrong_code') setRefusal(null);
            setScanning(false);
          }}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

/** The camera over the counter, reading the QR code in the buyer's app: a pickup code fills the boxes. Mounted while open. */
function QrScanner({ onClose, onCode }: Readonly<{ onClose: () => void; onCode: (code: string) => void }>) {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [notACode, setNotACode] = useState(false);
  const read = useRef(false);

  const onScanned = ({ data }: BarcodeScanningResult) => {
    const scanned = data.trim();
    if (read.current) return;
    if (!isPickupCodeFormat(scanned)) {
      setNotACode(true);
      return;
    }
    read.current = true;
    onCode(scanned);
  };

  const askable = permission ? !permission.granted && permission.canAskAgain : false;
  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.fill, { backgroundColor: theme.colors.bg }]}>
        {permission?.granted ? (
          <CameraView style={styles.fill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScanned} />
        ) : (
          <View style={[styles.fill, styles.centre, { padding: theme.space[6], gap: theme.space[2] }]}>
            <Text variant="titlePushed">{askable ? 'Scan their QR code' : 'Camera access is off'}</Text>
            <Text tone="muted">
              {askable
                ? "Allow the camera to scan the QR code in the buyer's app."
                : "Turn it on in Settings to scan the buyer's QR code, or type their code."}
            </Text>
            {askable ? <Button label="Allow camera" onPress={() => void requestPermission()} /> : null}
          </View>
        )}
        <SafeAreaView edges={['bottom']} style={{ padding: theme.space[4], gap: theme.space[2] }}>
          {permission?.granted ? (
            <Text tone={notACode ? 'danger' : 'muted'}>
              {notACode ? "That QR code isn't a pickup code." : "Point the camera at the QR code in the buyer's app."}
            </Text>
          ) : null}
          <Button label="Type the code instead" variant="secondary" onPress={onClose} />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

/** Handed over (catalogue v-hand #5): the indigo confirmation, the order's lines all collected, and back to orders. */
function Collected({ order }: Readonly<{ order: Order }>) {
  const theme = useTheme();
  const router = useRouter();
  const timeZone = useShopTimeZone();
  const band = useTopBand();
  const focused = useIsFocused();
  const collection = order.fulfilment.collection!;
  const line = [
    `Order #${order.display_id}`,
    buyerShortName(order) ?? collection.collected_by,
    openingLabel(collection.staff.at, new Date(), timeZone),
    `handed over by ${collection.staff.name ?? 'a staff member'}`,
  ].join(' · ');

  return (
    <TopBandScreen band={band} focused={focused}>
      <Animated.ScrollView {...band.scroll} contentContainerStyle={{ paddingBottom: theme.space[6] }}>
        <ConfirmationHero band={band} title="Collected" line={line} />
        <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
          {(order.items ?? []).map((item) => {
            const quantity = Number(item.quantity);
            return (
              <Line
                key={item.id}
                item={item}
                spoken="collected"
                trailing={<QuantityPill label={`${quantity}/${quantity}`} tone="picked" />}
              />
            );
          })}
        </View>
      </Animated.ScrollView>
      <SafeAreaView edges={['bottom']} style={{ paddingHorizontal: theme.space[3], paddingTop: theme.space[2] }}>
        <Button label="Back to orders" size="main" onPress={() => router.dismissTo('/')} />
      </SafeAreaView>
    </TopBandScreen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  centre: { justifyContent: 'center' },
});
