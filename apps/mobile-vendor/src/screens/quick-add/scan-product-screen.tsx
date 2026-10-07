import { Button, LoadingState, Text, useTheme } from '@oja/ui';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Field } from '@/components/field';

/** Product barcodes; QR and other symbologies aren't on shop shelves. */
const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'itf14'] as const;

/**
 * Quick-add's first step: scan the barcode of a product the shop stocks. The camera reports a
 * code many times a second, so only the first read moves on. A barcode can also be typed, for a
 * damaged label or a phone without a camera.
 */
export function ScanProductScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [typed, setTyped] = useState('');
  const scanned = useRef(false);

  const open = (barcode: string) => {
    if (scanned.current) return;
    scanned.current = true;
    router.replace({ pathname: '/quick-add/[barcode]', params: { barcode: barcode.trim() } });
  };

  const typeIt = (
    <View style={{ gap: theme.space.sm }}>
      <Field
        testID="barcode"
        placeholder="Or type the barcode"
        keyboardType="number-pad"
        returnKeyType="go"
        value={typed}
        onChangeText={setTyped}
        onSubmitEditing={() => typed.trim() && open(typed)}
      />
      <Button label="Look up" variant="secondary" disabled={!typed.trim()} onPress={() => open(typed)} />
    </View>
  );
  const cancel = <Button label="Cancel" variant="link" onPress={() => router.back()} />;

  if (!permission) return <LoadingState />;
  if (!permission.granted) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: theme.space.lg, gap: theme.space.md }}>
        <Text variant="title">Add a product</Text>
        <Text tone="secondary">
          {permission.canAskAgain
            ? "Allow the camera to scan the product's barcode."
            : 'Camera access is off. Turn it on in Settings, or type the barcode.'}
        </Text>
        {permission.canAskAgain ? <Button label="Allow camera" onPress={() => void requestPermission()} /> : null}
        {typeIt}
        {cancel}
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView
        style={styles.fill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
        onBarcodeScanned={({ data }: BarcodeScanningResult) => open(data)}
      />
      <View style={{ padding: theme.space.md, gap: theme.space.sm, backgroundColor: theme.colors.background }}>
        <Text tone="secondary">{"Point the camera at the product's barcode."}</Text>
        {typeIt}
        {cancel}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
