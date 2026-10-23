import type { Pin } from '@oja/domain';
import { Button, Icon, InlineNote, PressableSurface, Text, TextField, useTheme, type Theme } from '@oja/ui';
import { useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE, type MapStyleElement } from 'react-native-maps';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

/** How close the map opens: on a found place, on a state, or on the whole country. */
export type PinZoom = 'place' | 'state' | 'country';

/** Degrees of latitude the map shows at each zoom. */
const SPAN: Record<PinZoom, number> = { place: 0.004, state: 0.6, country: 9 };

export type PinRequest = { at: Pin; zoom: PinZoom };

/** The catalogue's muted map, in the theme's greys: no places of interest or transit. */
const quietMap = ({ colors }: Theme): MapStyleElement[] => [
  { elementType: 'geometry', stylers: [{ color: colors.tile }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: colors.muted }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: colors.tile }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: colors.raised }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: colors.line }] },
];

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
  const mapStyle = useMemo(() => quietMap(theme), [theme]);
  // The map's foot under the sheet's rounded top, and a little above it for Google's logo.
  const mapFoot = theme.radius.sheet + theme.space[3];

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
                customMapStyle={mapStyle}
                // The sheet laps over the map's foot: keep Google's logo, and the map's centre, above it.
                mapPadding={{ top: 0, right: 0, bottom: mapFoot, left: 0 }}
                showsPointsOfInterests={false}
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
                {stepLabel ? (
                  <View
                    style={[
                      styles.centred,
                      theme.elevation.floating,
                      { height: round, paddingHorizontal: theme.space[3], borderRadius: theme.radius.pill, backgroundColor: theme.colors.raised },
                    ]}>
                    <Text variant="label" weight="extrabold" style={{ color: theme.status.info.foreground }}>
                      {stepLabel}
                    </Text>
                  </View>
                ) : null}
              </SafeAreaView>
              {/* Lifted by half its height, so the pin's point is on the map's centre. */}
              <View pointerEvents="none" style={[styles.pinLayer, { bottom: mapFoot }]}>
                <View style={[styles.pin, { gap: theme.space[2] }]}>
                  <View style={{ backgroundColor: theme.colors.inverse, borderRadius: theme.radius.md, padding: theme.space[2] }}>
                    <Text variant="meta" weight="bold" style={{ color: theme.colors.onInverse }}>
                      {request.zoom === 'place' ? 'Drag the map to your gate' : 'Drag the map to where the rider should come'}
                    </Text>
                  </View>
                  <DropPin />
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
                    bottom: theme.radius.sheet + theme.space[2],
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.raised,
                  },
                ]}>
                <Icon name="locate" color={theme.colors.accent} />
              </PressableSurface>
            </View>
            {/* The sheet laps over the map, so its rounded top shows against it. */}
            <SafeAreaView
              edges={['bottom']}
              style={{
                marginTop: -theme.radius.sheet,
                backgroundColor: theme.colors.raised,
                borderTopLeftRadius: theme.radius.sheet,
                borderTopRightRadius: theme.radius.sheet,
                paddingHorizontal: theme.space[4],
                paddingTop: theme.space[2],
                paddingBottom: theme.space[4],
                gap: theme.space[2],
              }}>
              <View style={[styles.grabber, { width: theme.space[8] + theme.space[1], height: theme.space[1], backgroundColor: theme.colors.line }]} />
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

/** The pin: an indigo drop with a white dot, standing on its shadow. Its point is the delivery spot. */
function DropPin() {
  const theme = useTheme();
  const head = theme.control.md * 0.7;
  const dot = head * 0.35;
  return (
    <View accessible accessibilityLabel="Delivery pin" style={styles.centred}>
      <View
        style={[
          styles.centred,
          theme.elevation.floating,
          {
            width: head,
            height: head,
            borderRadius: head / 2,
            borderBottomLeftRadius: 0,
            backgroundColor: theme.colors.primary,
            transform: [{ rotate: '-45deg' }],
          },
        ]}>
        <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: theme.colors.onPrimary }} />
      </View>
      <View style={[{ backgroundColor: theme.colors.scrim, opacity: 0.4, marginTop: theme.space[2], width: dot * 1.2, height: dot * 0.4, borderRadius: dot }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  grabber: { alignSelf: 'center', borderRadius: 2 },
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
