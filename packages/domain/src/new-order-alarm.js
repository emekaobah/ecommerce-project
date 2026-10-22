// Plain JavaScript because the vendor app's app.config.ts bundles the sound it names, and Expo's
// config loader runs imported files on Node without transpiling TypeScript. Typed, with each
// value as its literal type, and documented by new-order-alarm.d.ts; new-order-alarm.test.ts
// checks the two agree.

export const NEW_ORDER_ALARM = {
  sound: "oja_alarm.wav",
  soundAsset: "./assets/sounds/oja_alarm.wav",
  channelId: "new-orders",
  channelName: "New orders",
  interruptionLevel: "time-sensitive",
}
