import { describe, expect, test } from "bun:test"
import { appIdentity } from "./app-identity"

describe("appIdentity", () => {
  test("names the buyer app after the product", () => {
    expect(appIdentity("buyer")).toEqual({
      name: "Oja",
      slug: "oja",
      scheme: "oja",
      bundleId: "com.emekaobah.oja.buyer",
    })
  })
})
