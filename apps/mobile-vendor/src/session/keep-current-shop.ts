import { currentShop } from '@oja/domain';
import { useEffect } from 'react';

import { queryClient } from '@/api/query-client';
import { useMemberships } from '@/api/sellers';

import { selectShop } from './select-shop';
import { saveTokenForShopChoice, useSession } from './session-store';
import { signOut } from './sign-out';

/**
 * Once the member's shops show they were removed from the shop the app acts for,
 * moves them to the only shop left, back to the shop picker, or out if none is left.
 */
export function useKeepCurrentShop(): void {
  const session = useSession();
  const { data: memberships } = useMemberships();

  useEffect(() => {
    if (!session || !memberships) return;
    const choice = currentShop(memberships, session.sellerId);
    if (choice.kind === 'only') void selectShop(choice.sellerId);
    else if (choice.kind === 'none') void signOut();
    else if (choice.kind === 'pick') {
      // Every cached query belonged to the shop they were removed from.
      queryClient.clear();
      void saveTokenForShopChoice(session.token);
    }
  }, [session, memberships]);
}
