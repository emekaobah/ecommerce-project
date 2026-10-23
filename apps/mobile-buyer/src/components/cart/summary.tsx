import { Text, useTheme } from '@oja/ui';
import { StyleSheet, View } from 'react-native';

/** A label and an amount on one line; the total sits a little apart, larger, with no rule above it. */
export function SumRow({
  label,
  value,
  total,
  tone,
}: Readonly<{ label: string; value: string; total?: boolean; tone?: 'leaf' }>) {
  const theme = useTheme();
  return (
    <View
      accessible
      style={[
        styles.spread,
        { gap: theme.space[3] },
        total ? { paddingTop: theme.space[2] } : null,
      ]}>
      <Text variant={total ? 'strong' : 'body'} tone={total ? 'default' : 'muted'} style={styles.shrink}>
        {label}
      </Text>
      {total ? (
        <Text variant="heading" tabular accessibilityRole="text">
          {value}
        </Text>
      ) : (
        <Text weight="bold" tone={tone} tabular>
          {value}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  shrink: { flexShrink: 1 },
});
