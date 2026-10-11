import { openingHoursLines, PICKUP_CODE_LENGTH, type WeeklyHours } from '@oja/domain';
import { Text, useTheme } from '@oja/ui';
import qrcode from 'qrcode-generator';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

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

/** One option of a radio group, outlined in ink when chosen. */
export function RadioOption({
  label,
  detail,
  selected,
  disabled,
  onPress,
}: Readonly<{ label: string; detail?: string; selected: boolean; disabled?: boolean; onPress: () => void }>) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: theme.touchTarget,
        padding: theme.space.md,
        gap: theme.space.xs,
        borderRadius: theme.radius.md,
        borderColor: selected ? theme.colors.ink : theme.colors.divider,
        borderWidth: selected ? 2 : 1,
      }}>
      <View style={styles.spread}>
        <Text variant="label" style={styles.shrink}>
          {label}
        </Text>
        {detail ? <Text variant="label">{detail}</Text> : null}
      </View>
    </Pressable>
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
    return Array.from({ length: count }, (_, row) => Array.from({ length: count }, (_, col) => qr.isDark(row, col)));
  }, [code]);
  const size = 6;
  return (
    <View style={{ alignItems: 'center', gap: theme.space.md }}>
      <View
        accessible
        accessibilityLabel={`QR code of your pickup code ${code.split('').join(' ')}`}
        style={{ padding: size * 4, backgroundColor: '#FFFFFF' }}>
        {modules.map((row, r) => (
          <View key={r} style={styles.row}>
            {row.map((dark, c) => (
              <View key={c} style={{ width: size, height: size, backgroundColor: dark ? '#000000' : '#FFFFFF' }} />
            ))}
          </View>
        ))}
      </View>
      <Text variant="heading" accessibilityLabel={`Pickup code ${code.split('').join(' ')}`} style={{ letterSpacing: 6 }}>
        {code.padStart(PICKUP_CODE_LENGTH, '0')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  shrink: { flexShrink: 1 },
});
