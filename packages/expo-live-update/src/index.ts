import type { LiveUpdateView } from '@oja/domain';
import { requireOptionalNativeModule } from 'expo';

// Android 16 Live Updates, and ongoing notifications on older Android (#133), for the buyer and
// vendor apps. What to show is `LiveUpdateView`, from @oja/domain. There's no native module on iOS
// or in a build from before this package, where these do nothing.

type OjaLiveUpdateModule = {
  show(view: LiveUpdateView): void;
  cancel(id: string, revision: number): void;
  cancelAll(): void;
};

const native = requireOptionalNativeModule<OjaLiveUpdateModule>('OjaLiveUpdate');

/** Posts it, or changes the one showing with the same id, without alerting. Ignored if it's older than what that id last showed. */
export function showLiveUpdate(view: LiveUpdateView): void {
  native?.show(view);
}

/** Takes it away. Ignored if it's older than what that id last showed. */
export function cancelLiveUpdate(id: string, revision: number): void {
  native?.cancel(id, revision);
}

/** Takes them all away, for when whoever they were for signs out. Other notifications stay. */
export function cancelAllLiveUpdates(): void {
  native?.cancelAll();
}
