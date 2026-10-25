import { addressLines, type StoredAddress } from '@oja/domain';
import { Text, useTheme } from '@oja/ui';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * An address as the buyer reads it: who, where, the landmark for the rider and the phone.
 * One saved without a name (#101) leads with where it is. `badge` sits beside the first line (e.g. "Default").
 */
export function AddressCard({ address, badge }: Readonly<{ address: StoredAddress; badge?: ReactNode }>) {
  const theme = useTheme();
  const { name, place, landmark, phone } = addressLines(address);
  return (
    <View style={{ gap: theme.space[1] }}>
      <View style={[styles.row, { gap: theme.space[2] }]}>
        <Text variant="strong" style={styles.shrink}>
          {name || place}
        </Text>
        {badge}
      </View>
      {name ? <Text tone="muted">{place}</Text> : null}
      {landmark ? <Text tone="muted">{landmark}</Text> : null}
      <Text tone="muted">{phone}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  shrink: { flexShrink: 1 },
});
