import type { Pin } from '@oja/domain';
import { Button, Text, useTheme } from '@oja/ui';
import { useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

/** How close the map opens: on a found place, on a state, or on the whole country. */
export type PinZoom = 'place' | 'state' | 'country';

/** Degrees of latitude the map shows at each zoom. */
const SPAN: Record<PinZoom, number> = { place: 0.004, state: 0.6, country: 9 };

export type PinRequest = { at: Pin; zoom: PinZoom };

/**
 * Where the delivery goes, confirmed on Google's map (ADR 0002): the pin starts where the
 * address search or the buyer's location put it, and they drag it, or tap the map, onto their
 * gate. The pin they confirm is the location of record.
 */
export function PinMap({
  request,
  onConfirm,
  onCancel,
}: Readonly<{
  request: PinRequest | null;
  onConfirm: (pin: Pin) => void;
  onCancel: () => void;
}>) {
  const theme = useTheme();
  // A found place or the buyer's location is a pin to adjust. A state or the country is only
  // where the map opens: the buyer places the pin themselves.
  const startingPin = (asked: PinRequest | null) => (asked?.zoom === 'place' ? asked.at : null);
  const [pin, setPin] = useState<Pin | null>(() => startingPin(request));
  // A new request starts the pin again, set while rendering so the old pin never shows.
  const [pinFor, setPinFor] = useState(request);
  if (pinFor !== request) {
    setPinFor(request);
    setPin(startingPin(request));
  }

  const span = request ? SPAN[request.zoom] : SPAN.country;
  return (
    <Modal visible={!!request} animationType="slide" onRequestClose={onCancel}>
      {/* A modal is its own native window: the app's safe area insets don't reach it. */}
      <SafeAreaProvider>
        {request ? (
          <SafeAreaView style={[styles.fill, { backgroundColor: theme.colors.bg }]} edges={['top', 'bottom']}>
            <View style={{ padding: theme.space[4], gap: theme.space[1] }}>
              <Text variant="heading">Confirm the delivery spot</Text>
              <Text tone="muted">
                {request.zoom === 'place'
                  ? 'Drag the pin onto your gate or entrance. The rider goes where the pin is.'
                  : 'Tap the map where the rider should come, then drag the pin onto your gate or entrance.'}
              </Text>
            </View>
            <MapView
              testID="pin-map"
              style={styles.fill}
              provider={PROVIDER_GOOGLE}
              initialRegion={{
                ...request.at,
                latitudeDelta: span,
                longitudeDelta: span,
              }}
              showsUserLocation
              onPress={(event) => setPin(event.nativeEvent.coordinate)}>
              {pin ? (
                <Marker
                  coordinate={pin}
                  draggable
                  onDragEnd={(event) => setPin(event.nativeEvent.coordinate)}
                  accessibilityLabel="Delivery pin"
                />
              ) : null}
            </MapView>
            <View style={{ padding: theme.space[4], gap: theme.space[2] }}>
              <Button label="Confirm pin" onPress={() => pin && onConfirm(pin)} disabled={!pin} />
              <Button label="Cancel" variant="link" onPress={onCancel} />
            </View>
          </SafeAreaView>
        ) : null}
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
