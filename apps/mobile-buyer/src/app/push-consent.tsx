import { PushConsentSheet } from '@/screens/push-consent/push-consent-sheet';

// Shown once after sign-in, before iOS's notification prompt (#136).
export default function PushConsentRoute() {
  return <PushConsentSheet />;
}
