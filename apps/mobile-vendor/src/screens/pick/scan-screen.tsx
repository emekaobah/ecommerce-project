import { scanBarcode, type ScanResult } from '@oja/domain';
import { Button, ErrorState, LoadingState, Text, useTheme, type StatusTone } from '@oja/ui';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { usePickList, useRecordPick, type PickListLine } from '@/api/orders';

/** Product barcodes; QR and other symbologies aren't on shop shelves. */
const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'itf14'] as const;
/**
 * The camera reports a barcode many times a second while it is in view. A code counts again
 * only once it has been out of view this long, so the next item of the same kind is a new scan.
 */
const OUT_OF_VIEW_MS = 1000;

type Feedback = { tone: StatusTone; symbol: string; message: string };

/**
 * Scan items while picking: a barcode on the order ticks one more of its line, any other warns.
 * Stays open for the next scan until staff are done.
 */
export function ScanScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const pickList = usePickList(id);
  const recordPick = useRecordPick(id);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const lastRead = useRef<{ code: string; at: number } | null>(null);

  const onScanned = ({ data }: BarcodeScanningResult) => {
    const now = Date.now();
    const stillInView = lastRead.current?.code === data && now - lastRead.current.at < OUT_OF_VIEW_MS;
    lastRead.current = { code: data, at: now };
    if (stillInView) return;
    const lines = pickList.data?.lines;
    if (!lines) return;
    const result = scanBarcode(lines, data);
    if (result.kind === 'picked') recordPick.mutate({ itemId: result.lineId, add: 1 });
    setFeedback(feedbackFor(result, lines));
  };

  const done = <Button label="Done" variant="secondary" onPress={() => router.back()} />;

  if (pickList.error && !pickList.data) {
    return (
      <View style={styles.fill}>
        <ErrorState title="Couldn't load the pick list" message={pickList.error.message} onRetry={() => void pickList.refetch()} />
        <View style={{ padding: theme.space[4] }}>{done}</View>
      </View>
    );
  }
  if (!permission || !pickList.data) return <LoadingState />;
  if (!permission.granted) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: theme.space[6], gap: theme.space[4] }}>
        <Text variant="titlePushed">Scan barcodes</Text>
        <Text tone="muted">
          {permission.canAskAgain
            ? 'Allow the camera to tick items off by their barcode.'
            : 'Camera access is off. Turn it on in Settings, or tick items off by hand.'}
        </Text>
        {permission.canAskAgain ? <Button label="Allow camera" onPress={() => void requestPermission()} /> : null}
        {done}
      </View>
    );
  }

  const colours = feedback ? theme.status[feedback.tone] : null;
  return (
    <View style={styles.fill}>
      <CameraView
        style={styles.fill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
        onBarcodeScanned={onScanned}
      />
      <View style={{ padding: theme.space[4], gap: theme.space[2], backgroundColor: theme.colors.bg }}>
        {feedback && colours ? (
          <View
            accessibilityLiveRegion="assertive"
            style={{ backgroundColor: colours.background, borderRadius: theme.radius.md, padding: theme.space[4] }}>
            <Text variant="strong" style={{ color: colours.foreground }}>
              {feedback.symbol} {feedback.message}
            </Text>
          </View>
        ) : (
          <Text tone="muted">Point the camera at an item&apos;s barcode. Move each item away before scanning the next.</Text>
        )}
        {recordPick.error ? <Text tone="danger">{recordPick.error.message}</Text> : null}
        {done}
      </View>
    </View>
  );
}

function feedbackFor(result: ScanResult, lines: PickListLine[]): Feedback {
  if (result.kind === 'not_in_order') {
    return { tone: 'danger', symbol: '✕', message: "This barcode isn't on the order. Check you have the right item." };
  }
  const line = lines.find((l) => l.id === result.lineId);
  const name = line?.product_title ?? 'Item';
  if (result.kind === 'already_picked') {
    return { tone: 'warning', symbol: '!', message: `${name}: all ${line?.quantity ?? ''} already picked.` };
  }
  return { tone: 'success', symbol: '✓', message: `${name}: ${result.picked} of ${line?.quantity ?? ''} picked.` };
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
