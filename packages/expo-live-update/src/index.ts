import type { LiveUpdateView } from '@oja/domain';
import { requireOptionalNativeModule } from 'expo';
import type * as ExpoNotifications from 'expo-notifications';
import type * as ExpoTaskManager from 'expo-task-manager';

import type { LiveUpdatePorts } from './applier';

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

const TASK = 'oja-live-update';

/**
 * Sets up the task that handles data-only pushes. An app's `background-task.android.ts` calls it,
 * imported by the app's entry file ahead of everything: with the app closed, Android runs only the
 * entry file's imports for such a push, and never reaches the root layout. The modules are passed
 * in so the app's own copies are the ones used (ADR 0012).
 */
export function registerLiveUpdateTask({
  TaskManager,
  Notifications,
  apply,
}: {
  TaskManager: typeof ExpoTaskManager;
  Notifications: typeof ExpoNotifications;
  apply: (payload: unknown, ports: LiveUpdatePorts) => void;
}): void {
  TaskManager.defineTask(TASK, ({ data, error }) => {
    if (error) console.warn('The Live Update task failed', error);
    else apply(data, { show: showLiveUpdate, cancel: cancelLiveUpdate });
    return Promise.resolve();
  });
  Notifications.registerTaskAsync(TASK).catch((error) => console.warn('Registering the Live Update task failed', error));
}
