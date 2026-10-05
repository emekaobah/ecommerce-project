import { scanBarcode, type ScanResult } from '@oja/domain';
import { Button, LoadingState, Text, useTheme, type StatusTone } from '@oja/ui';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { usePickList, useRecordPick, type PickListLine } from '@/api/orders';

/** Product barcodes; QR and other symbologies aren't on shop shelves. */
const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'itf14'] as const;
/** The camera reports a barcode many times a second while it is in view; one read counts per this long. */
const SAME_CODE_MS = 2000;

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
    if (lastRead.current?.code === data && now - lastRead.current.at < SAME_CODE_MS) return;
    lastRead.current = { code: data, at: now };
    const lines = pickList.data?.lines;
    if (!lines) return;
    const result = scanBarcode(lines, data);
    if (result.kind === 'picked') recordPick.mutate({ itemId: result.lineId, picked: result.picked });
    setFeedback(feedbackFor(result, lines));
  };

  const done = <Button label="Done" variant="secondary" onPress={() => router.back()} />;

  if (!permission) return <LoadingState />;
  if (!permission.granted) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: theme.space.lg, gap: theme.space.md }}>
        <Text variant="title">Scan barcodes</Text>
        <Text tone="secondary">
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
        onBarcodeScanned={pickList.data ? onScanned : undefined}
      />
      <View style={{ padding: theme.space.md, gap: theme.space.sm, backgroundColor: theme.colors.background }}>
        {feedback && colours ? (
          <View
            accessibilityLiveRegion="assertive"
            style={{ backgroundColor: colours.background, borderRadius: theme.radius.md, padding: theme.space.md }}>
            <Text variant="label" style={{ color: colours.foreground }}>
              {feedback.symbol} {feedback.message}
            </Text>
          </View>
        ) : (
          <Text tone="secondary">Point the camera at an item's barcode.</Text>
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
