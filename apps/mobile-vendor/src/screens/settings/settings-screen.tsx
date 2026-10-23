import { useTheme } from '@oja/ui';
import { ScrollView } from 'react-native';

import { useSession } from '@/session/session-store';

import { AccountRows } from './account-rows';
import { NewOrderAlertSetting } from './new-order-alert-setting';
import { ShopCard } from './shop-card';
import { TakingOrdersSetting } from './taking-orders-setting';

/**
 * Settings (catalogue v-shop #4): the shop's card with Taking orders and Full-screen new orders,
 * then Switch shop, Opening hours and Sign out. Each section is its own file.
 */
export function SettingsScreen() {
  const theme = useTheme();
  const sellerId = useSession()?.sellerId;
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[6], gap: theme.space[4] }}>
      <ShopCard sellerId={sellerId}>
        {sellerId ? <TakingOrdersSetting sellerId={sellerId} /> : null}
        <NewOrderAlertSetting />
      </ShopCard>
      <AccountRows sellerId={sellerId} />
    </ScrollView>
  );
}
