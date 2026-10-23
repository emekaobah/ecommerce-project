import type { ShopHours } from '@oja/domain';

import type { ShopHours as VendorShopHours } from '@/api/shop-hours';

/**
 * The shop's hours as `@oja/domain` counts time in them, with its pause in force; null until the
 * shop sets weekly hours, when the accept clock runs on the wall clock, as the server's does.
 */
export function shopHoursOf(shop: VendorShopHours | undefined): ShopHours | null {
  if (!shop?.weekly) return null;
  return { time_zone: shop.time_zone, weekly: shop.weekly, exceptions: shop.exceptions, pauses: shop.pause ? [shop.pause] : [] };
}
