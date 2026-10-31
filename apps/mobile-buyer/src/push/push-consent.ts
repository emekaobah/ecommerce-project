/** Where the phone stands on notification permission, as expo-notifications reports it. */
export type NotificationPermission = 'undetermined' | 'granted' | 'denied';

export type PushConsentFacts = {
  signedIn: boolean;
  permission: NotificationPermission;
  /** Whether this build can get a push token at all (a real phone with an EAS project id). */
  pushesCanArrive: boolean;
};

/**
 * Whether to show the consent screen before iOS's notification prompt (#136, App Store guideline
 * 4.5.4): only to a signed-in buyer whose phone hasn't been asked yet.
 */
export function shouldAskPushConsent({ signedIn, permission, pushesCanArrive }: PushConsentFacts): boolean {
  return signedIn && pushesCanArrive && permission === 'undetermined';
}
