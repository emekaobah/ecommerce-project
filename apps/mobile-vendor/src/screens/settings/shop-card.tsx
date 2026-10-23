import { settingsShopLine } from '@oja/domain';
import { ShopMark, Skeleton, Text, useTheme } from '@oja/ui';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useCurrentSeller } from '@/api/sellers';
import { useShopHours } from '@/api/shop-hours';
import { shopHoursOf } from '@/orders/shop-state';
import { useNow } from '@/orders/use-now';
import { useShopSnapshot } from '@/session/shop-snapshot';

/**
 * The shop's card on Settings (catalogue v-shop #4): its mark, name and state line ("Open until
 * 7pm · 2 orders waiting"), then the shop's switches. A shop without weekly hours is told buyers
 * can't see it until it sets them.
 */
export function ShopCard({ sellerId, children }: Readonly<{ sellerId: string | undefined; children: ReactNode }>) {
  const theme = useTheme();
  const seller = useCurrentSeller(sellerId);
  // Known from the last visit, so the card is named even before (or without) the server's answer.
  const kept = useShopSnapshot(sellerId);
  const name = seller.data?.name ?? kept?.name ?? null;
  const shop = useShopHours(sellerId);
  // Every half minute, so a pause that just began or ended counts.
  const now = useNow();
  const hours = shopHoursOf(shop.data);

  const stateLine = () => {
    if (!shop.data) return shop.error ? null : <Skeleton height={theme.space[4]} width="60%" radius="pill" />;
    if (!hours) {
      return (
        // Ember, not red: it asks for something to be done; red is only for reject, cancel and destroying.
        <Text variant="meta" weight="bold" style={{ color: theme.colors.emberText }}>
          {"Set your weekly hours in the web vendor panel: buyers can't see your shop until you do."}
        </Text>
      );
    }
    return (
      <Text variant="meta" tone="muted">
        {settingsShopLine(hours, now, shop.data.new_orders)}
      </Text>
    );
  };

  return (
    <View
      // As the catalogue draws it: on the page, with a divider under the switches.
      style={{
        marginTop: theme.space[4],
        paddingBottom: theme.space[2],
        gap: theme.space[2],
        borderBottomWidth: theme.line.divider,
        borderBottomColor: theme.colors.line,
      }}>
      <View style={[styles.row, { gap: theme.space[2] }]}>
        <ShopMark name={name ?? ''} logoUrl={seller.data?.logo} />
        <View style={[styles.fill, { gap: theme.space[1] }]}>
          <Text weight="bold">{name ?? ' '}</Text>
          {stateLine()}
        </View>
      </View>
      <View>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  fill: { flex: 1 },
});
