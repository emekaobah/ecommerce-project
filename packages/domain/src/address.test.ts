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

  test("Nigerian addresses separate the apartment from an optional landmark for the rider", () => {
    const fields = getAddressConfig("NG").fields

    expect(fields.find((f) => f.key === "address_2")).toMatchObject({ label: "Apartment, floor", required: false })
    expect(fields.find((f) => f.key === "metadata.landmark")).toMatchObject({
      label: "Landmark / directions for the rider",
      required: false,
      placeholder: "e.g. opposite the Mobil station",
    })
  })

  test("fails loudly for a country Oja doesn't serve yet", () => {
    expect(() => getAddressConfig("gh")).toThrow("No address config for country GH")
  })
})
