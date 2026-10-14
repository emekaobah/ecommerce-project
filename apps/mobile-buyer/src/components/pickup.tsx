import { openingHoursLines, type WeeklyHours } from '@oja/domain';
import { Text, useTheme } from '@oja/ui';
import qrcode from 'qrcode-generator';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

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
    <View style={{ gap: theme.space.xs }}>
      {lines.filter(Boolean).map((line) => (
        <Text key={line}>{line}</Text>
      ))}
      {address.landmark ? <Text tone="secondary">{address.landmark}</Text> : null}
      {place.instructions ? <Text tone="secondary">{place.instructions}</Text> : null}
      {place.phone ? <Text tone="secondary">{`Call ${place.phone}`}</Text> : null}
      {place.weekly ? (
        <View style={{ gap: theme.space.xs, paddingTop: theme.space.xs }}>
          <Text variant="label">Opening hours</Text>
          {openingHoursLines(place.weekly).map((line) => (
            <Text key={line} tone="secondary">
              {line}
            </Text>
          ))}
        </View>
      ) : null}
      {note ? <Text tone="secondary">{note}</Text> : null}
    </View>
  );
}

/**
 * The code to collect a pickup order with: its digits, and a QR code of them for the counter to
 * scan. Drawn from plain views, so no native module is needed.
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
  const size = 6;
  return (
    <View style={{ alignItems: 'center', gap: theme.space.md }}>
      <View
        accessible
        accessibilityLabel={`QR code of your pickup code ${code.split('').join(' ')}`}
        style={{ padding: size * 4, backgroundColor: '#FFFFFF' }}>
        {modules.map((row) => (
          <View key={row.key} style={styles.row}>
            {row.cells.map((cell) => (
              <View key={cell.key} style={{ width: size, height: size, backgroundColor: cell.dark ? '#000000' : '#FFFFFF' }} />
            ))}
          </View>
        ))}
      </View>
      <Text variant="heading" accessibilityLabel={`Pickup code ${code.split('').join(' ')}`} style={{ letterSpacing: 6 }}>
        {code}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
});
