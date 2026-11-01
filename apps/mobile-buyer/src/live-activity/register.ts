// Live Activities are iOS's (`register.ios.ts`): elsewhere this does nothing, until Android's Live Update (#146).

export const liveActivityTokens = {
  signedIn() {},
  pushTokenRegistered(_token: string) {},
  async signingOut() {},
};
