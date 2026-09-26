import { describe, expect, test } from "bun:test"
import { getAddressConfig } from "./address"

describe("getAddressConfig", () => {
  test("Nigerian addresses ask for a state from the fixed list and an LGA", () => {
    const config = getAddressConfig("ng")
    const state = config.fields.find((f) => f.label === "State")
    const lga = config.fields.find((f) => f.label === "LGA")

    expect(state).toMatchObject({ key: "province", required: true })
    expect(state?.options).toHaveLength(37)
    expect(state?.options).toContain("Lagos")
    expect(state?.options).toContain("Federal Capital Territory")
    expect(lga).toMatchObject({ key: "city", required: true })
  })

  test("fails loudly for a country Oja doesn't serve yet", () => {
    expect(() => getAddressConfig("gh")).toThrow("No address config for country GH")
  })
})
