import { cancelLiveUpdate, showLiveUpdate } from '@oja/expo-live-update';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { applyLiveUpdate } from './apply-live-update';

// Imported by the app's entry file, ahead of everything: with the app closed, Android runs only
// the entry file's imports for a data-only push, and never reaches the root layout.

const TASK = 'oja-live-update';

TaskManager.defineTask(TASK, async ({ data, error }) => {
  if (error) console.warn('The Live Update task failed', error);
  else applyLiveUpdate(data, { show: showLiveUpdate, cancel: cancelLiveUpdate });
});

Notifications.registerTaskAsync(TASK).catch((error) => console.warn('Registering the Live Update task failed', error));
