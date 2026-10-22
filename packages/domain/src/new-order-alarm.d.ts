/**
 * How a new order rings on shop staff's phones (#71): Oja's alarm sound, on a high-importance
 * Android channel the vendor app creates, and as iOS time-sensitive so it breaks through Focus.
 * The backend's push and the vendor app's sound and channel are named from here, so they agree.
 */
export declare const NEW_ORDER_ALARM: {
  /** The bundled sound's file name, as a push names it (iOS) and the channel plays it (Android). */
  readonly sound: "oja_alarm.wav"
  /** Where the vendor app keeps the sound, for the expo-notifications config plugin to bundle. */
  readonly soundAsset: "./assets/sounds/oja_alarm.wav"
  /** The Android channel the push is shown on. */
  readonly channelId: "new-orders"
  /** The channel's name in Android's notification settings. */
  readonly channelName: "New orders"
  /** Breaks through Focus and scheduled summaries; not a critical alert, which needs Apple's approval. */
  readonly interruptionLevel: "time-sensitive"
}
