import type { Pin } from '@oja/domain';
import { Button, Icon, InlineNote, PressableSurface, StatusChip, Text, TextField, useTheme } from '@oja/ui';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

/** How close the map opens: on a found place, on a state, or on the whole country. */
export type PinZoom = 'place' | 'state' | 'country';

/** Degrees of latitude the map shows at each zoom. */
const SPAN: Record<PinZoom, number> = { place: 0.004, state: 0.6, country: 9 };

export type PinRequest = { at: Pin; zoom: PinZoom };

/** A field the buyer fills on the map's sheet: its value, what's wrong with it, and how it changes. */
export type SheetField = { value: string; error?: string; onChange: (value: string) => void };

/**
 * Where the delivery goes, confirmed on Google's map (ADR 0002): the pin stays in the middle
 * and the buyer drags the map until it's on their gate. The sheet below names the address and
 * takes the rider's landmark and the courier's phone; "Confirm address" confirms the pin, which
 * is the location of record.
 */
export function PinMap({
  request,
  title,
  place,
  landmark,
  phone,
  stepLabel,
  confirmLabel,
  saving,
  problem,
  onLocate,
  onConfirm,
  onCancel,
}: Readonly<{
  request: PinRequest | null;
  /** The street address, "14 Bode Thomas Street". */
  title: string;
  /** The area and state, "Surulere, Lagos". */
  place: string;
  landmark: SheetField;
  phone: SheetField;
  /** "Step 1 of 3", at checkout. */
  stepLabel?: string;
  confirmLabel: string;
  saving: boolean;
  /** Why the address couldn't be used, in plain words. */
  problem: string | null;
  /** Where the buyer is now, once they allow it. */
  onLocate: () => Promise<Pin | null>;
  onConfirm: (pin: Pin) => void;
  onCancel: () => void;
}>) {
  const theme = useTheme();
  const map = useRef<MapView>(null);
  // The pin is the map's centre. A found place or the buyer's location is a pin to adjust; a
  // state or the country is only where the map opens, so the buyer moves it at least once.
  const [centre, setCentre] = useState<Pin | null>(request?.at ?? null);
  const [moved, setMoved] = useState(false);
  const [requested, setRequested] = useState(request);
  if (requested !== request) {
    setRequested(request);
    setCentre(request?.at ?? null);
    setMoved(false);
  }
  const pin = request?.zoom === 'place' || moved ? centre : null;
  const span = request ? SPAN[request.zoom] : SPAN.country;
  const round = theme.control.row;

  const locate = async () => {
    const here = await onLocate().catch(() => null);
    if (here) map.current?.animateToRegion({ ...here, latitudeDelta: SPAN.place, longitudeDelta: SPAN.place });
  };

  return (
    <Modal visible={!!request} animationType="slide" onRequestClose={onCancel}>
      {/* A modal is its own native window: the app's safe area insets don't reach it. */}
      <SafeAreaProvider>
        {request ? (
          <KeyboardAvoidingView
            style={[styles.fill, { backgroundColor: theme.colors.bg }]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.fill}>
              <MapView
                ref={map}
                testID="pin-map"
                style={StyleSheet.absoluteFill}
                provider={PROVIDER_GOOGLE}
                initialRegion={{ ...request.at, latitudeDelta: span, longitudeDelta: span }}
                showsUserLocation
                onRegionChangeComplete={(region, details) => {
                  setCentre({ latitude: region.latitude, longitude: region.longitude });
                  if (details?.isGesture !== false) setMoved(true);
                }}
              />
              <SafeAreaView edges={['top']} pointerEvents="box-none" style={[styles.topBar, { padding: theme.space[3] }]}>
                <PressableSurface
                  accessibilityRole="button"
                  accessibilityLabel="Back"
                  onPress={onCancel}
                  style={[
                    styles.centred,
                    theme.elevation.floating,
                    { width: round, height: round, borderRadius: theme.radius.md, backgroundColor: theme.colors.raised },
                  ]}>
                  <Icon name="back" />
                </PressableSurface>
                {stepLabel ? <StatusChip label={stepLabel} tone="info" /> : null}
              </SafeAreaView>
              {/* Lifted by half its height, so the pin's point is on the map's centre. */}
              <View pointerEvents="none" style={styles.pinLayer}>
                <View style={[styles.pin, { gap: theme.space[2] }]}>
                  <View style={{ backgroundColor: theme.colors.inverse, borderRadius: theme.radius.md, padding: theme.space[2] }}>
                    <Text variant="meta" weight="bold" style={{ color: theme.colors.onInverse }}>
                      {request.zoom === 'place' ? 'Drag the map to your gate' : 'Drag the map to where the rider should come'}
                    </Text>
                  </View>
                  <Icon name="pin" use="emblem" color={theme.colors.primary} label="Delivery pin" />
                </View>
              </View>
              <PressableSurface
                accessibilityRole="button"
                accessibilityLabel="Go to where I am"
                onPress={() => void locate()}
                style={[
                  styles.locate,
                  styles.centred,
                  theme.elevation.floating,
                  {
                    width: round,
                    height: round,
                    right: theme.space[4],
                    bottom: theme.space[4],
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.raised,
                  },
                ]}>
                <Icon name="locate" color={theme.colors.accent} />
              </PressableSurface>
            </View>
            <SafeAreaView
              edges={['bottom']}
              style={{
                backgroundColor: theme.colors.raised,
                borderTopLeftRadius: theme.radius.sheet,
                borderTopRightRadius: theme.radius.sheet,
                paddingHorizontal: theme.space[4],
                paddingTop: theme.space[4],
                paddingBottom: theme.space[4],
                gap: theme.space[2],
              }}>
              <Text variant="titlePushed">{title || 'Your delivery spot'}</Text>
              <Text tone="muted">{place ? `${place} · pin checked with the courier` : 'The pin is checked with the courier'}</Text>
              <TextField
                label="Landmark for the rider"
                optional
                value={landmark.value}
                error={landmark.error}
                onChangeText={landmark.onChange}
                placeholder="Blue gate opposite the pharmacy"
              />
              <TextField
                label="Phone · for the courier"
                value={phone.value}
                error={phone.error}
                onChangeText={phone.onChange}
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
              />
              {problem ? <InlineNote>{problem}</InlineNote> : null}
              <Button label={confirmLabel} size="main" onPress={() => pin && onConfirm(pin)} disabled={!pin} loading={saving} />
            </SafeAreaView>
          </KeyboardAvoidingView>
        ) : null}
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centred: { alignItems: 'center', justifyContent: 'center' },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pinLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  pin: { alignItems: 'center', transform: [{ translateY: '-50%' }] },
  locate: { position: 'absolute' },
});
