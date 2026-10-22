import { describe, expect, test } from "bun:test"
import { NEW_ORDER_ALARM } from "./new-order-alarm"

describe("NEW_ORDER_ALARM", () => {
  test("holds the values its declaration types it as", () => {
    // Type-checked against new-order-alarm.d.ts; compared at run time with new-order-alarm.js.
    const declared: typeof NEW_ORDER_ALARM = {
      sound: "oja_alarm.wav",
      soundAsset: "./assets/sounds/oja_alarm.wav",
      channelId: "new-orders",
      channelName: "New orders",
      interruptionLevel: "time-sensitive",
    }

    expect(NEW_ORDER_ALARM).toEqual(declared)
  })
})
