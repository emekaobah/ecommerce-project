// Plain JavaScript (typed by new-order-alarm.d.ts) because the vendor app's app.config.ts
// bundles the sound it names, and Expo's config loader runs imported files on Node without
// transpiling TypeScript.

/**
 * How a new order rings on shop staff's phones (#71): Oja's alarm sound, on a high-importance
 * Android channel the vendor app creates, and as iOS time-sensitive so it breaks through Focus.
 * The backend's push and the vendor app's sound and channel are named from here, so they agree.
 */
export const NEW_ORDER_ALARM = {
  /** The bundled sound's file name, as a push names it (iOS) and the channel plays it (Android). */
  sound: "oja_alarm.wav",
  /** Where the vendor app keeps the sound, for the expo-notifications config plugin to bundle. */
  soundAsset: "./assets/sounds/oja_alarm.wav",
  /** The Android channel the push is shown on. */
  channelId: "new-orders",
  /** The channel's name in Android's notification settings. */
  channelName: "New orders",
  /** Breaks through Focus and scheduled summaries; not a critical alert, which needs Apple's approval. */
  interruptionLevel: "time-sensitive",
}
