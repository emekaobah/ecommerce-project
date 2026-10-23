import { Text, useTheme } from '@oja/ui';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

/** A white card on the grouped background: one shop's part of the cart or checkout. */
export function Card({ children, gap = 3 }: Readonly<{ children: ReactNode; gap?: 2 | 3 }>) {
  const theme = useTheme();
  return (
    <View
      style={{
        gap: theme.space[gap],
        padding: theme.space[3],
        borderRadius: theme.radius.lg,
        borderWidth: theme.line.divider,
        borderColor: theme.colors.line,
        backgroundColor: theme.colors.raised,
      }}>
      {children}
    </View>
  );
}

/** A label and an amount on one line; the total sits under a rule, larger. */
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
        total ? { paddingTop: theme.space[2], borderTopWidth: theme.line.divider, borderTopColor: theme.colors.line } : null,
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
