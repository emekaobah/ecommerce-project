import { queryClient } from '@/api/query-client';
import { fetchMemberships, sellerKeys } from '@/api/sellers';
import { vendorClient } from '@/api/client';
import { selectShop } from '@/session/select-shop';
import { getSession } from '@/session/session-store';

/**
 * Acts for the shop a push is about before its screen opens, when the member is in several.
 * False when nobody is signed in or the member has since left that shop: nothing to open.
 */
export async function actForShop(sellerId: string | null): Promise<boolean> {
  const session = getSession();
  if (!session) return false;
  if (!sellerId || sellerId === session.sellerId) return true;
  const memberships = await queryClient.fetchQuery({
    queryKey: sellerKeys.memberships(),
    queryFn: () => fetchMemberships(vendorClient),
  });
  if (!memberships.some((m) => m.seller_id === sellerId)) return false;
  await selectShop(sellerId);
  return true;
}
