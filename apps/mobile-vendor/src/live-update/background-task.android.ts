import { registerLiveUpdateTask } from '@oja/expo-live-update';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';

import { applyLiveUpdate } from './apply-live-update';

registerLiveUpdateTask({ TaskManager, Notifications, SecureStore, apply: applyLiveUpdate });
