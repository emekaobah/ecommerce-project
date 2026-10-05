import { addressLines, type StoredAddress } from '@oja/domain';
import { Text, useTheme } from '@oja/ui';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * An address as the buyer reads it: who, where, the landmark for the rider and the phone.
 * `badge` sits beside the name (e.g. "Default").
 */
export function AddressCard({ address, badge }: Readonly<{ address: StoredAddress; badge?: ReactNode }>) {
  const theme = useTheme();
  const { name, place, landmark, phone } = addressLines(address);
  return (
    <View style={{ gap: theme.space.xs }}>
      <View style={[styles.row, { gap: theme.space.sm }]}>
        <Text variant="label" style={styles.shrink}>
          {name}
        </Text>
        {badge}
      </View>
      <Text tone="secondary">{place}</Text>
      {landmark ? <Text tone="secondary">{landmark}</Text> : null}
      <Text tone="secondary">{phone}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  shrink: { flexShrink: 1 },
});
