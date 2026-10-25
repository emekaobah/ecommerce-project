import { describe, expect, test } from "bun:test"
import { addressFromForm, addressFormValues, pinOf } from "./address-form"

const filled = {
  first_name: " Ada ",
  last_name: "Obi",
  address_1: "3 Akin Adesola Street",
  address_2: "",
  "metadata.landmark": "Opposite the Mobil station",
  city: "Eti-Osa",
  province: "Lagos",
  phone: "0803 123 4567",
}

describe("addressFromForm", () => {
  test("turns a filled Nigerian form into a delivery address, the landmark in metadata", () => {
    expect(addressFromForm(filled, "NG")).toEqual({
      ok: true,
      address: {
        first_name: "Ada",
        last_name: "Obi",
        address_1: "3 Akin Adesola Street",
        address_2: null,
        city: "Eti-Osa",
        province: "Lagos",
        country_code: "ng",
        phone: "+2348031234567",
        metadata: { landmark: "Opposite the Mobil station" },
      },
    })
  })

  test("takes an address without a name: checkout asks who receives the order", () => {
    const result = addressFromForm({ ...filled, first_name: "", last_name: " " }, "NG")

    expect(result).toMatchObject({ ok: true, address: { first_name: null, last_name: null, address_1: "3 Akin Adesola Street" } })
  })

  test("leaves out an empty landmark", () => {
    const result = addressFromForm({ ...filled, "metadata.landmark": "  " }, "NG")

    expect(result.ok && result.address.metadata).toEqual({})
  })

  test("names every missing required field, and a phone number that can't be right", () => {
    const result = addressFromForm({ ...filled, address_1: " ", city: "", phone: "0803 123" }, "NG")

    expect(result).toEqual({
      ok: false,
      errors: {
        address_1: "Enter the street address",
        city: "Enter the LGA",
        phone: "Enter a phone number like 0803 123 4567",
      },
    })
  })

  test("keeps the pin the buyer confirmed, to six decimal places", () => {
    const result = addressFromForm(filled, "NG", { latitude: 6.431812345, longitude: 3.421498765 })

    expect(result.ok && result.address.metadata).toEqual({
      landmark: "Opposite the Mobil station",
      latitude: 6.431812,
      longitude: 3.421499,
    })
  })

  test("only takes a state from the country's list", () => {
    const result = addressFromForm({ ...filled, province: "Lagos State" }, "NG")

    expect(result).toEqual({ ok: false, errors: { province: "Choose a state" } })
  })
})

describe("addressFormValues", () => {
  test("fills the form back from a saved address, in the buyer's own phone format", () => {
    const address = addressFromForm(filled, "NG")
    if (!address.ok) throw new Error("expected a valid address")

    expect(addressFormValues(address.address, "NG")).toEqual({
      first_name: "Ada",
      last_name: "Obi",
      address_1: "3 Akin Adesola Street",
      address_2: "",
      "metadata.landmark": "Opposite the Mobil station",
      city: "Eti-Osa",
      province: "Lagos",
      phone: "08031234567",
    })
  })

  test("starts empty, with the buyer's name when known", () => {
    expect(addressFormValues(null, "NG", { first_name: "Ada", last_name: null })).toMatchObject({
      first_name: "Ada",
      last_name: "",
      address_1: "",
      province: "",
    })
  })

  test("starts with the buyer's account phone, in the format people type", () => {
    expect(addressFormValues(null, "NG", { first_name: "Ada", phone: "+2348031234567" })).toMatchObject({
      first_name: "Ada",
      phone: "08031234567",
    })
  })
})

describe("pinOf", () => {
  test("reads the pin the buyer confirmed back from an address's metadata", () => {
    expect(pinOf({ metadata: { landmark: "x", latitude: 6.4281, longitude: 3.4219 } })).toEqual({
      latitude: 6.4281,
      longitude: 3.4219,
    })
  })

  test("is null for an address without a whole pin, or none", () => {
    expect(pinOf({ metadata: { latitude: 6.4281 } })).toBeNull()
    expect(pinOf({ metadata: null })).toBeNull()
    expect(pinOf(null)).toBeNull()
  })
})
