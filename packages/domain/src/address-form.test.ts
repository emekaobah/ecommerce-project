import { describe, expect, test } from "bun:test"
import { addressFromForm, addressFormValues } from "./address-form"

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
})
