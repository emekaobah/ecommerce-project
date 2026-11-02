import { vendorActivitySellerId } from '@oja/domain';
import { tokenReporter, watchActivities } from '@oja/expo-live-activity';
import { addPushToStartTokenListener } from 'expo-widgets';
import { AppState, Platform } from 'react-native';

import { env } from '@/config/env';
import type { Session } from '@/session/session-store';

import { memberKeyPorts, phone } from './phone-reporter';
import { shopActivity } from './shop-activity';

// Imported by the root layout, so it runs at JS startup, on a background launch too (#140).

/** The server starts this app's activities by push, which iOS only allows from here. */
const FIRST_PUSH_TO_START_IOS = 17.2;

const reporter = tokenReporter<Session | undefined>({
  ...memberKeyPorts(() => {
    for (const activity of shopActivity.getInstances()) void activity.end('immediate').catch(() => {});
  }),
  subjectField: 'seller_id',
  post: async (key, report) => phone.resultOf(await phone.postWithKey(`${env.apiUrl}/vendor/live-activity-tokens`, key, { ...report, environment: phone.environment })),
});

watchActivities({
  modules: { addPushToStartTokenListener, AppState },
  activities: () => shopActivity.getInstances(),
  subjectOf: vendorActivitySellerId,
  reporter,
});

export const liveActivityTokens = {
  ...reporter,
  /** Android links its Expo token to the phone: iOS's activities don't go through Expo. */
  pushTokenRegistered(_token: string) {},
  /** Whether this phone can run the shop's activity, so the switch shows. */
  available: Number.parseFloat(String(Platform.Version)) >= FIRST_PUSH_TO_START_IOS,
};
