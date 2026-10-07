import { Text, useTheme } from '@oja/ui';
import { StyleSheet, Switch, View } from 'react-native';

/** A yes-or-no setting: its label, and a switch. */
export function ToggleRow({
  label,
  value,
  onChange,
}: Readonly<{ label: string; value: boolean; onChange: (value: boolean) => void }>) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { minHeight: theme.touchTarget, gap: theme.space.md }]}>
      <Text style={styles.shrink}>{label}</Text>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  shrink: { flexShrink: 1 },
});
