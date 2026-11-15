import { cancelAllLiveUpdates } from '@oja/expo-live-update';

// Live Activities are iOS's (`register.ios.ts`). Android's Live Update (#148) has no tokens to
// report: the backend finds the phone by its Expo push token. The phone only has to clear what's
// showing, which may be a pickup code, when its buyer signs out.

export const liveActivityTokens = {
  available: true,
  signedIn() {},
  pushTokenRegistered(_token: string) {},
  signingOut() {
    cancelAllLiveUpdates();
    return Promise.resolve();
  },
};
