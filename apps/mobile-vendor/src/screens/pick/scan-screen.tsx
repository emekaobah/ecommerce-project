import { pickLineView, scanBarcode, type ScanResult } from '@oja/domain';
import {
  Button,
  ErrorState,
  haptics,
  Icon,
  LoadingState,
  PressableSurface,
  QuantityPill,
  StatusChip,
  Text,
  useTheme,
  useToast,
  type ToastMessage,
} from '@oja/ui';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOrder, usePickList, useRecordPick, type PickListLine } from '@/api/orders';

import { LinePhoto } from './line-photo';

/** Product barcodes; QR and other symbologies aren't on shop shelves. */
const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'itf14'] as const;
/**
 * The camera reports a barcode many times a second while it is in view. A code counts again
 * only once it has been out of view this long, so the next item of the same kind is a new scan.
 */
const OUT_OF_VIEW_MS = 1000;
/** The camera's dim around the reticle, and the glass of the buttons over it (catalogue `.reticle`, `.camtop`). */
const DIM = 'rgba(0, 0, 0, 0.5)';
const GLASS = 'rgba(255, 255, 255, 0.18)';
const ON_CAMERA = '#FFFFFF';
/** Behind the camera's picture, in both themes (catalogue `.cam`). */
const CAMERA_BACKDROP = '#0B0C10';
/** The scanning window's height: the catalogue's 140 mockup px at the apps' 1.2 scale. */
const RETICLE_HEIGHT = 168;

/**
 * Scan items (catalogue v-pick #2): the camera fills the screen, a reticle in the middle; each
 * barcode on the order ticks one more of its line and confirms in a toast, any other warns. The
 * card at the foot keeps what is still to pick in view. Stays open for the next scan until closed.
 */
export function ScanScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const order = useOrder(id);
  const pickList = usePickList(id);
  const recordPick = useRecordPick(id);
  const [torch, setTorch] = useState(false);
  const lastRead = useRef<{ code: string; at: number } | null>(null);
  const close = () => router.back();

  const onScanned = ({ data }: BarcodeScanningResult) => {
    const now = Date.now();
    const stillInView = lastRead.current?.code === data && now - lastRead.current.at < OUT_OF_VIEW_MS;
    lastRead.current = { code: data, at: now };
    if (stillInView) return;
    const lines = pickList.data?.lines;
    if (!lines) return;
    const result = scanBarcode(lines, data);
    if (result.kind === 'picked') {
      haptics.selection();
      recordPick.mutate(
        { itemId: result.lineId, add: 1 },
        { onError: () => toast({ message: "Couldn't save that scan. Check your connection and scan it again.", tone: 'problem' }) },
      );
    } else {
      haptics.warning();
    }
    toast(scanToast(result, lines));
  };

  if (pickList.error && !pickList.data) {
    return (
      <SafeAreaView style={[styles.fill, { padding: theme.space[4], backgroundColor: theme.colors.bg }]}>
        <ErrorState
          title="Couldn't load the pick list"
          body="Check your connection and try again. Nothing you've picked is lost."
          error={pickList.error}
          onRetry={() => void pickList.refetch()}
        />
        <Button label="Close" variant="secondary" size="main" onPress={close} />
      </SafeAreaView>
    );
  }
  if (!permission || !pickList.data) return <LoadingState />;
  if (!permission.granted) {
    return (
      <SafeAreaView style={[styles.fill, { justifyContent: 'center', padding: theme.space[6], gap: theme.space[4], backgroundColor: theme.colors.bg }]}>
        <Text variant="titlePushed">Scan items</Text>
        <Text tone="muted">
          {permission.canAskAgain
            ? 'Allow the camera to tick items off by their barcode.'
            : 'Camera access is off. Turn it on in Settings, or tick items off by hand.'}
        </Text>
        {permission.canAskAgain ? <Button label="Allow camera" size="main" onPress={() => void requestPermission()} /> : null}
        <Button label="Close" variant="secondary" size="main" onPress={close} />
      </SafeAreaView>
    );
  }

  const { lines, progress } = pickList.data;
  const toPick = lines.filter((line) => progress.unpicked.includes(line.id));
  const title = order.data ? `Scan items · #${order.data.display_id}` : 'Scan items';

  return (
    <View style={[styles.fill, { backgroundColor: CAMERA_BACKDROP }]}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
        onBarcodeScanned={onScanned}
      />
      <Reticle />
      {/* Padded by hand: a full-screen modal's SafeAreaView reports no top inset. */}
      <View style={[styles.fill, { paddingTop: insets.top, paddingBottom: insets.bottom }]} pointerEvents="box-none">
        <View style={[styles.row, styles.spread, { paddingHorizontal: theme.space[3], paddingTop: theme.space[2] }]}>
          <CameraButton icon="x" label="Close" onPress={close} />
          <Text variant="strong" accessibilityRole="header" style={{ color: ON_CAMERA }}>
            {title}
          </Text>
          <CameraButton icon="flash" label={torch ? 'Torch off' : 'Torch on'} selected={torch} onPress={() => setTorch(!torch)} />
        </View>
        <View style={styles.fill} pointerEvents="none" />
        <StillToPick lines={toPick} />
      </View>
    </View>
  );
}

/** The toast each scan confirms with: the line and its count, or why nothing was ticked. */
function scanToast(result: ScanResult, lines: PickListLine[]): ToastMessage {
  if (result.kind === 'not_in_order') return { message: "That barcode isn't on this order", tone: 'problem' };
  const line = lines.find((l) => l.id === result.lineId);
  const name = line?.product_title ?? 'Item';
  if (result.kind === 'already_picked') return { message: `${name} · all ${line?.quantity ?? ''} already picked`, tone: 'problem' };
  return { message: `${name} · ${result.picked} of ${line?.quantity ?? ''} picked` };
}

/**
 * The scanning window: white-edged with rounded corners, the camera dimmed around it (a hole cut
 * out of the dim), a sun line across it. A third of the way down, as in the catalogue.
 */
function Reticle() {
  const theme = useTheme();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const side = theme.space[6];
  const radius = theme.radius.lg;
  const hole = size
    ? { x: side, y: (size.height - RETICLE_HEIGHT) / 3, width: size.width - side * 2, height: RETICLE_HEIGHT }
    : null;
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => setSize(event.nativeEvent.layout)}>
      {size && hole ? (
        <>
          <Svg width={size.width} height={size.height} style={StyleSheet.absoluteFill}>
            <Path
              fill={DIM}
              fillRule="evenodd"
              d={`M0 0H${size.width}V${size.height}H0Z ${roundedRect(hole, radius)}`}
            />
          </Svg>
          <View
            style={[
              styles.centre,
              {
                position: 'absolute',
                left: hole.x,
                top: hole.y,
                width: hole.width,
                height: hole.height,
                borderWidth: 3,
                borderColor: ON_CAMERA,
                borderRadius: radius,
              },
            ]}>
            <View style={{ height: 2, alignSelf: 'stretch', marginHorizontal: theme.space[2], backgroundColor: theme.colors.sun }} />
          </View>
        </>
      ) : null}
    </View>
  );
}

/** An SVG path for a rectangle with rounded corners. */
function roundedRect({ x, y, width, height }: { x: number; y: number; width: number; height: number }, r: number) {
  return [
    `M${x + r} ${y}H${x + width - r}A${r} ${r} 0 0 1 ${x + width} ${y + r}`,
    `V${y + height - r}A${r} ${r} 0 0 1 ${x + width - r} ${y + height}`,
    `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + height - r}`,
    `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`,
  ].join('');
}

/** A 38pt glass button over the camera (its hit area 44pt): close, and the torch. */
function CameraButton({
  icon,
  label,
  selected,
  onPress,
}: Readonly<{ icon: 'x' | 'flash'; label: string; selected?: boolean; onPress: () => void }>) {
  const theme = useTheme();
  return (
    <PressableSurface
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      hitSlop={(theme.hitArea - theme.control.md) / 2}
      onPress={onPress}
      style={[
        styles.centre,
        {
          width: theme.control.md,
          height: theme.control.md,
          borderRadius: theme.radius.md,
          backgroundColor: selected ? theme.colors.sun : GLASS,
        },
      ]}>
      <Icon name={icon} color={selected ? theme.colors.onSun : ON_CAMERA} />
    </PressableSurface>
  );
}

/** The card at the foot: the lines with units still to pick, and their pills. */
function StillToPick({ lines }: Readonly<{ lines: PickListLine[] }>) {
  const theme = useTheme();
  return (
    <View
      style={{
        marginHorizontal: theme.space[3],
        marginBottom: theme.space[3],
        padding: theme.space[3],
        gap: theme.space[2],
        borderRadius: theme.radius.xl,
        backgroundColor: theme.colors.raised,
        maxHeight: '45%',
      }}>
      <View style={[styles.row, styles.spread, { gap: theme.space[2] }]}>
        <Text variant="strong">Still to pick</Text>
        <StatusChip label={lines.length === 1 ? '1 line' : `${lines.length} lines`} tone="info" icon={null} />
      </View>
      {lines.length ? (
        <ScrollView contentContainerStyle={{ gap: theme.space[2] }}>
          {lines.map((line) => (
            <View
              key={line.id}
              accessible
              accessibilityLabel={`${line.product_title ?? 'Item'}, ${toPickNote(line)}`}
              style={[styles.row, { gap: theme.space[2] }]}>
              <LinePhoto uri={line.thumbnail} />
              <View style={styles.fill}>
                <Text weight="bold">{line.product_title ?? 'Item'}</Text>
                <Text variant="meta" tone="muted">
                  {toPickNote(line)}
                </Text>
              </View>
              <QuantityPill {...pickLineView(line).pill} />
            </View>
          ))}
        </ScrollView>
      ) : (
        <Text tone="muted">Every line is picked. Close the camera to pack the order.</Text>
      )}
    </View>
  );
}

/** "1 to pick", or "2 needed · 1 marked short" while some of the line is short. */
function toPickNote(line: PickListLine) {
  if (line.unavailable > 0) return `${line.quantity} needed · ${line.unavailable} marked short`;
  return `${line.quantity - line.picked} to pick`;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  spread: { justifyContent: 'space-between' },
  centre: { alignItems: 'center', justifyContent: 'center' },
});
