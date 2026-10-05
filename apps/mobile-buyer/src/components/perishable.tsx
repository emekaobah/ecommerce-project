import { PERISHABLE_DELIVERY_RULE } from '@oja/domain';
import { StatusChip, Text, useTheme } from '@oja/ui';
import { View } from 'react-native';

/** Marks a perishable item (#69): a symbol and a label, never colour alone. */
export function PerishableChip() {
  return <StatusChip label="Perishable" tone="info" symbol="❄" />;
}

/** The perishable chip with the delivery rule it brings, for the product page. */
export function PerishableNotice() {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space.xs }}>
      <PerishableChip />
      <Text variant="caption" tone="secondary">
        {PERISHABLE_DELIVERY_RULE}
      </Text>
    </View>
  );
}
