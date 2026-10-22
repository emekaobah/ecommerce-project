/** How a new order rings on shop staff's phones (#71). */
export declare const NEW_ORDER_ALARM: {
  /** The bundled sound's file name, as a push names it (iOS) and the channel plays it (Android). */
  readonly sound: string
  /** Where the vendor app keeps the sound, for the expo-notifications config plugin to bundle. */
  readonly soundAsset: string
  /** The Android channel the push is shown on. */
  readonly channelId: string
  /** The channel's name in Android's notification settings. */
  readonly channelName: string
  /** Breaks through Focus and scheduled summaries; not a critical alert, which needs Apple's approval. */
  readonly interruptionLevel: "time-sensitive"
}
