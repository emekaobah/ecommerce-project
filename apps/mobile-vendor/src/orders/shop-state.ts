import { openingLabel, shopStatus, type ShopHours, type ShopStatus } from '@oja/domain';

import type { ShopHours as VendorShopHours } from '@/api/shop-hours';

/**
 * The shop's hours as `@oja/domain` counts time in them, with its pause in force; null until the
 * shop sets weekly hours, when the accept clock runs on the wall clock, as the server's does.
 */
export function shopHoursOf(shop: VendorShopHours | undefined): ShopHours | null {
  if (!shop?.weekly) return null;
  return { time_zone: shop.time_zone, weekly: shop.weekly, exceptions: shop.exceptions, pauses: shop.pause ? [shop.pause] : [] };
}

/** The orders header's state: the pill ("Open", leaf) and the line under the shop's name. */
export type ShopState = { pill: string; open: boolean; line: string };

const dateLabel = (now: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(now).replace(',', '');

/** What the state says after the date: "open until 7pm", "opens 7am", "paused until 3pm". */
function stateLine(status: ShopStatus, now: Date, timeZone: string): string {
  const at = (iso: string) => openingLabel(iso, now, timeZone);
  if (status.state === 'open') return status.closes_at ? `open until ${at(status.closes_at)}` : 'open all day';
  if (status.state === 'closed') return status.opens_at ? `opens ${at(status.opens_at)}` : 'closed';
  const closed = status.reason === 'pause' ? 'paused' : 'closed';
  return status.until ? `${closed} until ${at(status.until)}` : closed;
}

/** "Mon 20 Oct · open until 7pm" with an Open pill, worked out now, so it never goes stale on screen. */
export function shopState(hours: ShopHours, now: Date): ShopState {
  const status = shopStatus(hours, now);
  const pill = { open: 'Open', closed: 'Closed', closed_until: status.state === 'closed_until' && status.reason === 'pause' ? 'Paused' : 'Closed' }[
    status.state
  ];
  return { pill, open: status.state === 'open', line: `${dateLabel(now, hours.time_zone)} · ${stateLine(status, now, hours.time_zone)}` };
}
