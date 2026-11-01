import { buyerActivityOrderId, type BuyerActivityContent } from '@oja/domain';
import { liveActivityPhone, watchActivities } from '@oja/expo-live-activity';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { addPushToStartTokenListener } from 'expo-widgets';
import { AppState, Platform } from 'react-native';

import { storeClient } from '@/api/client';
import { env } from '@/config/env';

import { orderActivity } from './order-activity';
import { tokenReporter, type OwedActivity } from './token-reporter';

// Imported by the root layout, so it runs at JS startup, on a background launch too (#140).

const FIRST_PUSH_TO_START_IOS = 17.2;

const phone = liveActivityPhone({ Constants, SecureStore });
const { environment, withKey } = phone;
const publishable = { 'x-publishable-api-key': env.publishableKey };

const reporter = tokenReporter({
  ...phone,
  register: async (key, pushToken) => {
    const { device } = await storeClient.store.liveActivityDevices.mutate({ environment, ...(pushToken ? { push_token: pushToken } : {}), ...withKey(key) });
    return device.key;
  },
  remove: async (key) => {
    await storeClient.store.liveActivityDevices.current.delete(withKey(key));
  },
  post: async (key, report) => phone.resultOf(await phone.postWithKey(`${env.apiUrl}/store/live-activity-tokens`, key, { ...report, environment }, publishable)),
  owed: async (key) => (await storeClient.store.liveActivities.owed.query(withKey(key))).activities as OwedActivity[],
  startActivity: (content: BuyerActivityContent, url) => {
    const activity = orderActivity.start(content, url);
    watcher.watch(activity);
    return activity.getId();
  },
  recordStarted: async (key, orderId, activityId) => {
    const { ok } = await phone.postWithKey(`${env.apiUrl}/store/live-activities`, key, { order_id: orderId, activity_id: activityId, environment }, publishable);
    if (!ok) throw new Error(`Recording activity ${activityId} failed`);
  },
  startsActivitiesItself: () => Number.parseFloat(String(Platform.Version)) < FIRST_PUSH_TO_START_IOS,
  endActivities: () => {
    for (const activity of orderActivity.getInstances()) void activity.end('immediate').catch(() => {});
  },
});

const watcher = watchActivities({
  modules: { addPushToStartTokenListener, AppState },
  activities: () => orderActivity.getInstances(),
  subjectOf: buyerActivityOrderId,
  reporter,
});

export const liveActivityTokens = { ...reporter, available: true };
