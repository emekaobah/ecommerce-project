import { dealLabel, type ShopDeal } from '@oja/domain';
import { DealBadge } from '@oja/ui';
import { StyleSheet, View } from 'react-native';

/**
 * A listing's shop's automatic promotions (#6) as sun badges: the first, or (`all`) each of them;
 * nothing when it has none. The store returns only deals for the buyer's region, currency, sales
 * channel and country (ADR 0014), so every one is shown as it comes.
 */
export function DealBadges({
  deals,
  all = false,
}: Readonly<{ deals: (ShopDeal & { promotion_id: string })[]; all?: boolean }>) {
  const shown = all ? deals : deals.slice(0, 1);
  if (!shown.length) return null;
  return (
    <View style={styles.row}>
      {shown.map((deal) => (
        <DealBadge key={deal.promotion_id} label={dealLabel(deal)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
});
