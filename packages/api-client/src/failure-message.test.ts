import { describe, expect, test } from "bun:test"
import { ClientError } from "@mercurjs/client"
import { failureMessage, isRefusal } from "./failure-message"

const refused = (status: number, message: string) => new ClientError(message, "", status)
const fallback = "Couldn't cancel the order. Check your connection and try again."

describe("failureMessage", () => {
  test("a 409 refusal is said in the API's own words, written for the person", () => {
    expect(failureMessage(refused(409, "The order has already been handed over."), fallback)).toBe("The order has already been handed over.")
  })

  test("a 400 is never shown: it may be developer text", () => {
    expect(failureMessage(refused(400, "Stage must be one of new, picking"), fallback)).toBe(fallback)
  })

  test("the screen words a status it knows", () => {
    const words = { 403: "Only the owner or a manager can cancel an accepted order." }
    expect(failureMessage(refused(403, "Forbidden"), fallback, words)).toBe("Only the owner or a manager can cancel an accepted order.")
  })

  test("anything that isn't a refusal, a dropped connection say, gets the screen's words", () => {
    expect(failureMessage(new TypeError("Network request failed"), fallback)).toBe(fallback)
  })
})

describe("isRefusal", () => {
  test("only a 409 is a refusal to show; everything else goes to Sentry", () => {
    expect(isRefusal(refused(409, "Taken"))).toBe(true)
    expect(isRefusal(refused(400, "Bad"))).toBe(false)
    expect(isRefusal(new Error("offline"))).toBe(false)
  })
})
