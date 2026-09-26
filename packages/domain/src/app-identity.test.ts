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

  test("gives the vendor app its own name, slug and scheme so both apps install side by side", () => {
    expect(appIdentity("vendor")).toEqual({
      name: "Oja Vendor",
      slug: "oja-vendor",
      scheme: "ojavendor",
      bundleId: "com.emekaobah.oja.vendor",
    })
  })
})
