import { Button, Sheet } from '@oja/ui';

import { closeSheetThen } from '@/navigation';
import { registerAfterConsent } from '@/push/push-registration';

/**
 * What Oja will notify the buyer about, before iOS asks for permission: the in-app consent App
 * Store guideline 4.5.4 requires for promotional pushes (#136). Continuing closes it, then iOS's
 * prompt shows and the device registers as before.
 */
export function PushConsentSheet() {
  return (
    <Sheet
      title="Notifications"
      message="We'll tell you about your orders and items you leave in your cart. You can change this in Settings."
      actions={<Button label="Continue" variant="primary" size="main" onPress={() => closeSheetThen(registerAfterConsent)} />}
    />
  );
}
