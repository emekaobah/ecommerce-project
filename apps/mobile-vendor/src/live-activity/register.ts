import { cancelAllLiveUpdates } from '@oja/expo-live-update';

import type { Session } from '@/session/session-store';

import { phoneReporter } from './phone-reporter';

// Live Activities are iOS's (`register.ios.ts`). Android's Live Update (#149) has no Apple tokens to
// report, but its switch needs the phone's key just the same, and the backend finds the phone by the
// Expo push token linked to that key. There's nothing to post with the key alone.

let pushToken: string | undefined;

const reporter = phoneReporter({ post: async () => 'ok', pushToken: () => pushToken, endActivities: cancelAllLiveUpdates });

export const liveActivityTokens = {
  ...reporter,
  /** Whether this phone can run the shop's activity, so the switch shows. */
  available: true,
  /** The phone registered for pushes, so the backend can reach it: links its token, switch or no switch. */
  pushTokenRegistered(token: string) {
    pushToken = token;
    reporter.signedIn();
  },
  /** Before sign-out: forgets the phone, and clears what's showing about its shops. */
  async signingOut(session: Session | undefined) {
    pushToken = undefined;
    await reporter.signingOut(session);
  },
};
