import { NEW_ORDER_ALARM, newOrderBanner, newOrderPush, newOrderTakeover, type NewOrderPush } from '@oja/domain';
import { reportError } from '@oja/expo-sentry';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { getNewOrderAlertMode } from '@/alerts/new-order-alert-store';
import { getSession } from '@/session/session-store';

import { actForShop } from './act-for-shop';

/** The order the takeover is showing, if it is on screen. */
let showing: string | null = null;
/** Orders accepted, viewed or put off on this phone since the app started: they never take over again. */
const answered = new Set<string>();

/** The takeover screen says when it opens. */
export function takeoverOpened(orderId: string): void {
  showing = orderId;
}

/** And when it closes, unless another order's takeover has already taken its place. */
export function takeoverClosed(orderId: string): void {
  if (showing === orderId) showing = null;
}

/** Accept order, View order or Not now: a push for this order coming again won't reopen it. */
export function takeoverAnswered(orderId: string): void {
  answered.add(orderId);
}

/** The new order a push arriving while the app is open shows full screen (#83); null shows it as a banner. */
function takeoverFor(data: unknown): NewOrderPush | null {
  return newOrderTakeover(data, { mode: getNewOrderAlertMode(), signedIn: Boolean(getSession()), showing, answered });
}

/** Whether the system keeps quiet about a push: the takeover shows it, or is showing it already. */
export function shownInApp(data: unknown): boolean {
  return takeoverFor(data) !== null || (showing !== null && newOrderPush(data)?.orderId === showing);
}

/**
 * Opens the takeover for a new order's push, acting for its shop first. A second new order
 * arriving while one is showing takes its place: the first stays in the New queue, as after Not
 * now. The system kept quiet about the push (`shownInApp`), so a takeover that can't open after
 * all, the shop left or not checkable, rings as a banner instead: a new order is never silent.
 */
export async function openTakeover(notification: Notifications.Notification): Promise<void> {
  const push = takeoverFor(notification.request.content.data);
  if (!push) return;
  let canOpen = false;
  try {
    canOpen = await actForShop(push.sellerId);
  } catch (error) {
    reportError(error, "Couldn't act for a new order's shop");
  }
  if (!canOpen) {
    await ringAsBanner(notification);
    return;
  }
  showTakeover(push);
}

function showTakeover({ orderId }: NewOrderPush) {
  if (showing === orderId) return;
  const href = { pathname: '/new-order/[id]', params: { id: orderId } } as const;
  if (showing) router.replace(href);
  else router.push(href);
}

/** The push again as a banner with the alarm, in place of the quiet copy in the notification list. */
async function ringAsBanner(notification: Notifications.Notification): Promise<void> {
  const { identifier, content } = notification.request;
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title: content.title, body: content.body, data: newOrderBanner(content.data), sound: NEW_ORDER_ALARM.sound },
      trigger: Platform.OS === 'android' ? { channelId: NEW_ORDER_ALARM.channelId } : null,
    });
    await Notifications.dismissNotificationAsync(identifier);
  } catch (error) {
    reportError(error, "Couldn't ring a new order as a banner");
  }
}
