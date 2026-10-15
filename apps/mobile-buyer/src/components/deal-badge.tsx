import { dealLabel, type ShopDeal } from '@oja/domain';
import { Text, useTheme } from '@oja/ui';
import { StyleSheet, View } from 'react-native';

/**
 * A listing's shop's automatic promotion (#6), e.g. "10% off at this shop": saffron, the colour
 * kept for deals. Only ever that shop's own deal; no badge compares shops (docs/design.md).
 */
export function DealBadge({ deal }: Readonly<{ deal: ShopDeal }>) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: theme.colors.deal, borderRadius: theme.radius.pill, paddingHorizontal: theme.space.sm },
      ]}>
      <Text variant="caption" style={styles.label}>
        {`% ${dealLabel(deal)}`}
      </Text>
    </View>
  );
}

/** The listing's first deal, or (`all`) each of them; nothing when it has none. */
export function DealBadges({
  deals,
  all = false,
}: Readonly<{ deals: (ShopDeal & { promotion_id: string })[]; all?: boolean }>) {
  const theme = useTheme();
  const shown = all ? deals : deals.slice(0, 1);
  if (!shown.length) return null;
  return (
    <View style={[styles.row, { gap: theme.space.xs }]}>
      {shown.map((deal) => (
        <DealBadge key={deal.promotion_id} deal={deal} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', paddingVertical: 2 },
  label: { fontWeight: '600' },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
});
