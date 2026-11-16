import { vendorActivitySellerId } from '@oja/domain';
import { FIRST_PUSH_TO_START_IOS, tokenReporter, watchActivities } from '@oja/expo-live-activity';
import { addPushToStartTokenListener } from 'expo-widgets';
import { AppState, Platform } from 'react-native';

import { env } from '@/config/env';
import type { Session } from '@/session/session-store';

import { memberKeyPorts, phone } from './phone-reporter';
import { shopActivity } from './shop-activity';

// Imported by the root layout, so it runs at JS startup, on a background launch too (#140).

const reporter = tokenReporter<Session | undefined>({
  ...memberKeyPorts(() => {
    for (const activity of shopActivity.getInstances()) void activity.end('immediate').catch(() => {});
  }),
  // Android links its Expo token to the phone: iOS's activities don't go through Expo.
  linksPushToken: false,
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
  /** Whether this phone can run the shop's activity, so the switch shows: the server starts it by push. */
  available: Number.parseFloat(String(Platform.Version)) >= FIRST_PUSH_TO_START_IOS,
};
