import { reportError } from '@oja/expo-sentry';
import { InlineNote, SwitchRow } from '@oja/ui';
import { useState } from 'react';

import { useOrdersOnLockScreen, useSetOrdersOnLockScreen } from '@/api/live-activity';
import { liveActivityTokens } from '@/live-activity/register';

/**
 * "Orders on Lock Screen" (#146): the shop's order counts on this phone's Lock Screen and in the
 * Dynamic Island, or as an ongoing notification on Android (#149). Off until turned on, for this phone and this shop, and open to any member, since
 * the phone in the shop is often held by staff. A save that fails flips back and says so.
 */
export function OrdersOnLockScreenSetting({ sellerId }: Readonly<{ sellerId: string }>) {
  const saved = useOrdersOnLockScreen(sellerId);
  const save = useSetOrdersOnLockScreen(sellerId);
  const [notKept, setNotKept] = useState(false);
  if (!liveActivityTokens.available) return null;
  return (
    <>
      <SwitchRow
        label="Orders on Lock Screen"
        description="Starts with the day's first order."
        // What's being saved shows while it saves; a failed save goes back to what's saved.
        value={save.isPending ? save.variables : (saved.data ?? false)}
        disabled={saved.isPending}
        onValueChange={(on) => {
          setNotKept(false);
          save.mutate(on, {
            onError: (error) => {
              reportError(error, "Couldn't save Orders on Lock Screen");
              setNotKept(true);
            },
          });
        }}
      />
      {notKept ? <InlineNote>{"Couldn't save that. Check your connection and try again."}</InlineNote> : null}
    </>
  );
}
