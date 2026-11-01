// Live Activities are iOS's (`register.ios.ts`): elsewhere this does nothing, until Android's ongoing notification (#133's slice 3).

export const liveActivityTokens = {
  /** Whether this phone can run the shop's activity, so the switch shows. */
  available: false,
  signedIn() {},
  retry() {},
  currentKey: async (): Promise<string | null> => null,
  ensureKey: async (): Promise<string> => {
    throw new Error('Live Activities are iOS only');
  },
  async signingOut(_session: unknown) {},
};
