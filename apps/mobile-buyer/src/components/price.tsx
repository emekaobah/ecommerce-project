import { formatMoney, type DisplayPrice } from '@oja/domain';
import { Text, useTheme, type TextProps } from '@oja/ui';
import { StyleSheet, View } from 'react-native';

/** A shop's price, with the "was" price struck through when it has one. */
export function Price({
  price,
  currencyCode,
  from = false,
  variant = 'label',
}: Readonly<{ price: DisplayPrice; currencyCode: string; from?: boolean; variant?: TextProps['variant'] }>) {
  const theme = useTheme();
  const amount = formatMoney(price.amount, currencyCode);
  const was = price.compareAt == null ? null : formatMoney(price.compareAt, currencyCode);
  return (
    <View
      style={[styles.row, { gap: theme.space.xs }]}
      accessible
      accessibilityLabel={`${from ? 'From ' : ''}${amount}${was ? `, was ${was}` : ''}`}>
      <Text variant={variant}>{from ? `From ${amount}` : amount}</Text>
      {was ? (
        <Text variant="caption" tone="secondary" style={styles.struck}>
          {was}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' },
  struck: { textDecorationLine: 'line-through' },
});
