import { describe, expect, test } from "bun:test"
import type { DeliveryAddress } from "./address-form"
import { contactFromForm, nameFromForm, nameOf, receiverOf } from "./contact"

/** Ada's office, saved from "Use my current location" without a name. */
const office: DeliveryAddress = {
  first_name: null,
  last_name: null,
  address_1: "12 Adeola Odeku Street",
  address_2: null,
  city: "Eti-Osa",
  province: "Lagos",
  country_code: "ng",
  phone: "+2348031234567",
  metadata: { latitude: 6.4302, longitude: 3.4178 },
}

describe("receiverOf", () => {
  test("keeps the name the address was saved with", () => {
    const named = { ...office, first_name: "Ada", last_name: "Obi" }

    expect(receiverOf(named, { first_name: "Adaeze", last_name: "Okafor" })).toEqual(named)
  })

  test("names an address saved without one after the buyer's account", () => {
    expect(receiverOf(office, { first_name: " Ada ", last_name: "Obi" })).toEqual({
      ...office,
      first_name: "Ada",
      last_name: "Obi",
    })
  })

  test("is null when neither the address nor the account has a whole name: checkout asks", () => {
    expect(receiverOf(office, { first_name: "Ada", last_name: null })).toBeNull()
    expect(receiverOf({ ...office, first_name: "Ada" }, undefined)).toBeNull()
  })
})

describe("nameFromForm", () => {
  test("is the receiver's name as typed, trimmed", () => {
    expect(nameFromForm({ first_name: " Ada ", last_name: "Obi" })).toEqual({
      ok: true,
      name: { first_name: "Ada", last_name: "Obi" },
    })
  })

  test("names each part that's missing", () => {
    expect(nameFromForm({ first_name: "Ada", last_name: " " })).toEqual({
      ok: false,
      errors: { last_name: "Enter the last name" },
    })
  })
})

describe("contactFromForm", () => {
  test("is the buyer's name and phone, the phone in E.164", () => {
    expect(contactFromForm({ first_name: "Ada", last_name: "Obi", phone: "0803 123 4567" }, "NG")).toEqual({
      ok: true,
      contact: { first_name: "Ada", last_name: "Obi", phone: "+2348031234567" },
    })
  })

  test("names what each field needs", () => {
    expect(contactFromForm({ first_name: "", last_name: "Obi", phone: "0803" }, "NG")).toEqual({
      ok: false,
      errors: { first_name: "Enter the first name", phone: "Enter a phone number like 0803 123 4567" },
    })
    expect(contactFromForm({ first_name: "Ada", last_name: "Obi" }, "NG")).toEqual({
      ok: false,
      errors: { phone: "Enter the phone number" },
    })
  })
})

describe("nameOf", () => {
  test("is the whole name, trimmed", () => {
    expect(nameOf({ first_name: " Ada ", last_name: "Obi" })).toEqual({ first_name: "Ada", last_name: "Obi" })
  })

  test("is null for an account with half a name, or none", () => {
    expect(nameOf({ first_name: "Ada", last_name: null })).toBeNull()
    expect(nameOf(null)).toBeNull()
  })
})
