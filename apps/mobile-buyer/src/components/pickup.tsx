import { openingHoursLines, pickupCodeGroups, type WeeklyHours } from '@oja/domain';
import { SCALE, Text, useTheme } from '@oja/ui';
import qrcode from 'qrcode-generator';
import { useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

/** A collection point's address, as checkout and the order show it. */
type PickupAddress = {
  address_1: string | null;
  address_2: string | null;
  city: string | null;
  province: string | null;
  landmark: string | null;
};

/** Where and when to collect a shop's order (#12): the shop's collection point and its own hours. */
export type PickupPlace = {
  address: PickupAddress;
  instructions: string;
  phone: string | null;
  weekly: WeeklyHours | null;
};

/** The collection point's address, its instructions and phone, and the shop's hours. */
export function PickupDetails({ place, note }: Readonly<{ place: PickupPlace; note?: string | null }>) {
  const theme = useTheme();
  const { address } = place;
  const lines = [[address.address_1, address.address_2].filter(Boolean).join(', '), [address.city, address.province].filter(Boolean).join(', ')];
  return (
    <View style={{ gap: theme.space[1] }}>
      {lines.filter(Boolean).map((line) => (
        <Text key={line}>{line}</Text>
      ))}
      {address.landmark ? <Text tone="muted">{address.landmark}</Text> : null}
      {place.instructions ? <Text tone="muted">{place.instructions}</Text> : null}
      {place.phone ? <Text tone="muted">{`Call ${place.phone}`}</Text> : null}
      {place.weekly ? (
        <View style={{ gap: theme.space[1], paddingTop: theme.space[1] }}>
          <Text variant="strong">Opening hours</Text>
          {openingHoursLines(place.weekly).map((line) => (
            <Text key={line} tone="muted">
              {line}
            </Text>
          ))}
        </View>
      ) : null}
      {note ? <Text tone="muted">{note}</Text> : null}
    </View>
  );
}

/** The catalogue's QR (`.bigqr`): 180 mockup px square, never wider than the screen allows. */
const QR_MOCKUP = 180;

/** The QR's side on this screen, so its loading shape matches it. */
export function usePickupQrSide() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  return Math.min(QR_MOCKUP * SCALE, width - theme.space[4] * 2);
}

/** "4 8 2 9 1 3": a code spoken digit by digit, never as one number. */
const spokenDigits = (code: string) => code.split('').join(' ');

/**
 * The code to collect a pickup order with, as it's shown at the counter: a big QR code of it on
 * white in both themes (so scanners read it) and its digits in groups of three. Drawn from plain
 * views, so no native module is needed. Both speak the code digit by digit.
 */
export function PickupCode({ code }: Readonly<{ code: string }>) {
  const theme = useTheme();
  const modules = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(code);
    qr.make();
    const count = qr.getModuleCount();
    // A module's place in the grid is what it is, so it keys it.
    return Array.from({ length: count }, (_, row) => ({
      key: `row-${row}`,
      cells: Array.from({ length: count }, (_, col) => ({ key: `${row}:${col}`, dark: qr.isDark(row, col) })),
    }));
  }, [code]);
  const side = usePickupQrSide();
  const padding = theme.space[4];
  const moduleSize = (side - padding * 2) / modules.length;
  return (
    <View style={{ alignItems: 'center', gap: theme.space[3] }}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`QR code of your pickup code, ${spokenDigits(code)}`}
        style={{ width: side, height: side, padding, borderRadius: theme.radius.xl, backgroundColor: theme.colors.paper }}>
        {modules.map((row) => (
          <View key={row.key} style={styles.row}>
            {row.cells.map((cell) => (
              <View key={cell.key} style={{ width: moduleSize, height: moduleSize, backgroundColor: cell.dark ? theme.colors.band : undefined }} />
            ))}
          </View>
        ))}
      </View>
      <Text
        variant="displayXxl"
        tone="onBand"
        tabular
        numberOfLines={1}
        adjustsFontSizeToFit
        accessibilityRole="text"
        accessibilityLabel={`Pickup code ${spokenDigits(code)}`}
        // The catalogue's .14em tracking, so the groups read apart at a counter.
        style={[styles.digits, { letterSpacing: theme.type.displayXxl.fontSize * 0.14 }]}>
        {pickupCodeGroups(code)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  digits: { textAlign: 'center' },
});
