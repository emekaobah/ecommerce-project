import { phoneKey } from '@oja/expo-live-activity';
import { cancelAllLiveUpdates } from '@oja/expo-live-update';

import type { Session } from '@/session/session-store';

import { memberKeyPorts } from './phone-reporter';

// Live Activities are iOS's (`register.ios.ts`). Android's Live Update (#149) has no Apple tokens to
// report, but its switch needs the phone's key just the same, and the backend finds the phone by the
// Expo push token linked to that key.

export const liveActivityTokens = {
  ...phoneKey<Session | undefined>(memberKeyPorts(cancelAllLiveUpdates)),
  /** Whether this phone can run the shop's activity, so the switch shows. */
  available: true,
};
