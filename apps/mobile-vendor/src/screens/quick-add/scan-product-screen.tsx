import { Button, Icon, PressableSurface, Text, TextField, useTheme, type IconName } from '@oja/ui';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Product barcodes; QR and other symbologies aren't on shop shelves. */
const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'itf14'] as const;

/**
 * Quick-add's first step (catalogue v-shop #1): the camera, full screen, reading the barcode of
 * a product the shop stocks; the camera reports a code many times a second, so only the first
 * read moves on. A damaged label, or a phone without the camera, types the code instead
 * (states #15, camera off: "Allow camera" while it can still be asked for).
 */
export function ScanProductScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [typed, setTyped] = useState('');
  const [torch, setTorch] = useState(false);
  const scanned = useRef(false);
  // Over the camera picture, in both themes: white, with the light wash behind the top buttons.
  const onCamera = { ink: theme.colors.onBand, wash: theme.colors.onBandTile };

  const open = (barcode: string) => {
    if (scanned.current || !barcode.trim()) return;
    scanned.current = true;
    router.replace({ pathname: '/quick-add/[barcode]', params: { barcode: barcode.trim() } });
  };

  const typeIt = (
    <View style={{ gap: theme.space[2] }}>
      <TextField
        label="Barcode"
        labelHidden
        testID="barcode"
        placeholder="Or type the barcode"
        keyboardType="number-pad"
        returnKeyType="go"
        value={typed}
        onChangeText={setTyped}
        onSubmitEditing={() => open(typed)}
      />
      <Button label="Look up" variant="secondary" disabled={!typed.trim()} onPress={() => open(typed)} />
    </View>
  );

  if (!permission?.granted) {
    // Not asked yet, or refused: typing always works.
    const askable = !permission || permission.canAskAgain;
    const emblem = theme.block.quietEmblem;
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: theme.colors.bg }]}>
        <View style={[styles.row, { paddingHorizontal: theme.space[2], minHeight: theme.hitArea, gap: theme.space[1] }]}>
          <TopButton icon="x" label="Close" tint={theme.colors.ink} onPress={() => router.back()} />
          <Text variant="titlePushed">Add a product</Text>
        </View>
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.middle, { paddingTop: theme.block.stateTop, paddingHorizontal: theme.block.stateSide, gap: theme.space[2] }]}>
            <View style={[styles.centre, { width: emblem, height: emblem, borderRadius: theme.radius.sheet, backgroundColor: theme.colors.tile }]}>
              <Icon name="camera" use="quietEmblem" color={theme.colors.accent} />
            </View>
            <Text variant="titlePushed" style={styles.centred} accessibilityRole="header">
              {askable ? 'Scan with the camera' : 'Camera access is off'}
            </Text>
            <Text tone="muted" style={styles.centred}>
              {askable
                ? 'Allow the camera to scan barcodes, or type the barcode below.'
                : 'Turn it on in Settings to scan barcodes, or type the barcode below.'}
            </Text>
            {askable ? <Button label="Allow camera" style={styles.stretch} onPress={() => void requestPermission()} /> : null}
          </View>
          <View style={{ padding: theme.space[4], paddingTop: theme.space[5] }}>{typeIt}</View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.inverse }]}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
        onBarcodeScanned={({ data }: BarcodeScanningResult) => open(data)}
      />
      <SafeAreaView edges={['top']}>
        <View style={[styles.row, styles.between, { paddingHorizontal: theme.space[4], paddingTop: theme.space[2] }]}>
          <TopButton icon="x" label="Close" tint={onCamera.ink} fill={onCamera.wash} onPress={() => router.back()} />
          <Text variant="heading" style={{ color: onCamera.ink }}>
            Add a product
          </Text>
          <TopButton
            icon="flash"
            label="Torch"
            tint={onCamera.ink}
            fill={onCamera.wash}
            selected={torch}
            onPress={() => setTorch((on) => !on)}
          />
        </View>
      </SafeAreaView>
      <View style={[styles.fill, styles.centre, { paddingHorizontal: theme.space[12] }]} pointerEvents="none">
        <View style={[styles.reticle, { borderRadius: theme.radius.xl, borderColor: onCamera.ink, borderWidth: theme.line.ring }]}>
          <View style={{ height: theme.line.ring, backgroundColor: theme.colors.sun, marginHorizontal: theme.space[2] }} />
        </View>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView edges={['bottom']} style={{ paddingHorizontal: theme.space[3], paddingBottom: theme.space[2] }}>
          <View style={{ backgroundColor: theme.colors.raised, borderRadius: theme.radius.sheet, padding: theme.space[4], gap: theme.space[3] }}>
            <Text weight="bold">{"Point the camera at the product's barcode."}</Text>
            {typeIt}
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** A square button at the top of the screen: close, or the torch (sun while on). */
function TopButton({
  icon,
  label,
  tint,
  fill,
  selected,
  onPress,
}: Readonly<{ icon: IconName; label: string; tint: string; fill?: string; selected?: boolean; onPress: () => void }>) {
  const theme = useTheme();
  return (
    <PressableSurface
      accessibilityRole={selected === undefined ? 'button' : 'switch'}
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { checked: selected }}
      onPress={onPress}
      style={[
        styles.centre,
        { width: theme.hitArea, height: theme.hitArea, borderRadius: theme.radius.md, backgroundColor: selected ? theme.colors.sun : fill },
      ]}>
      <Icon name={icon} color={selected ? theme.colors.onSun : tint} />
    </PressableSurface>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { justifyContent: 'space-between' },
  centre: { alignItems: 'center', justifyContent: 'center' },
  middle: { alignItems: 'center' },
  centred: { textAlign: 'center' },
  stretch: { alignSelf: 'stretch' },
  reticle: { alignSelf: 'stretch', aspectRatio: 1.6, justifyContent: 'center' },
});
