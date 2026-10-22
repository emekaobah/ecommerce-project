import { formatMoney, type DisplayPrice } from '@oja/domain';
import { Text, useTheme, type TextProps } from '@oja/ui';
import { StyleSheet, View } from 'react-native';

/** A shop's price, with the "was" price struck through when it has one. */
export function Price({
  price,
  currencyCode,
  variant = 'strong',
}: Readonly<{
  /** `from` marks a listing whose variants are priced differently. */
  price: DisplayPrice & { from?: boolean };
  currencyCode: string;
  variant?: TextProps['variant'];
}>) {
  const theme = useTheme();
  const { from = false } = price;
  const amount = formatMoney(price.amount, currencyCode);
  const was = price.compareAt == null ? null : formatMoney(price.compareAt, currencyCode);
  const shown = from ? `From ${amount}` : amount;
  return (
    <View
      style={[styles.row, { gap: theme.space[1] }]}
      accessible
      accessibilityLabel={was ? `${shown}, was ${was}` : shown}>
      <Text variant={variant} tabular>
        {shown}
      </Text>
      {was ? (
        <Text variant="meta" tone="muted" tabular style={styles.struck}>
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
