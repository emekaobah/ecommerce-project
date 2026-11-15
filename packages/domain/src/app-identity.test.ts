import { describe, expect, test } from "bun:test"
import { apnsEnvironment, appIdentity } from "./app-identity"

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

describe("apnsEnvironment", () => {
  test("store and internal builds are signed for Apple's production push service", () => {
    expect(apnsEnvironment("production")).toEqual({ entitlement: "production", host: "production" })
    expect(apnsEnvironment("preview")).toEqual({ entitlement: "production", host: "production" })
  })

  test("development builds, and any built without a profile, use the sandbox", () => {
    expect(apnsEnvironment("development")).toEqual({ entitlement: "development", host: "sandbox" })
    expect(apnsEnvironment(undefined)).toEqual({ entitlement: "development", host: "sandbox" })
  })
})
