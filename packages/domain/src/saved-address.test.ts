import { describe, expect, test } from "bun:test"
import { addressBook, addressLines, checkoutAddressOf,preselectedAddress, savedAddressEdit, savedAddressFor } from "./saved-address"

/** Ada's home, as the store keeps it: Medusa's columns, the landmark and her pin in metadata. */
const home = {
  id: "caddr_home",
  is_default_shipping: true,
  first_name: "Ada",
  last_name: "Obi",
  address_1: "3 Akin Adesola Street",
  address_2: "Flat 4",
  city: "Eti Osa",
  province: "Lagos",
  postal_code: null,
  country_code: "ng",
  phone: "+2348031234567",
  metadata: { landmark: "Opposite the Mobil station", latitude: 6.4318, longitude: 3.4215 },
}

/** Ada's office, saved after her home. */
const office = {
  ...home,
  id: "caddr_office",
  is_default_shipping: false,
  address_1: "12 Adeola Odeku Street",
  address_2: null,
  metadata: { latitude: 6.4302, longitude: 3.4178 },
}

describe("addressLines", () => {
  test("shows who, where, the landmark for the rider and the phone", () => {
    expect(addressLines(home)).toEqual({
      name: "Ada Obi",
      place: "3 Akin Adesola Street, Flat 4, Eti Osa, Lagos",
      landmark: "Opposite the Mobil station",
      phone: "+2348031234567",
    })
  })

  test("has no landmark line when the buyer gave none, and skips empty columns", () => {
    expect(addressLines({ ...home, address_2: null, metadata: { landmark: " " } })).toEqual({
      name: "Ada Obi",
      place: "3 Akin Adesola Street, Eti Osa, Lagos",
      landmark: null,
      phone: "+2348031234567",
    })
  })
})

describe("checkoutAddressOf", () => {
  test("is the saved address as checkout takes it, with its pin and landmark", () => {
    expect(checkoutAddressOf(home, "NG")).toEqual({
      first_name: "Ada",
      last_name: "Obi",
      address_1: "3 Akin Adesola Street",
      address_2: "Flat 4",
      city: "Eti Osa",
      province: "Lagos",
      country_code: "ng",
      phone: "+2348031234567",
      metadata: { landmark: "Opposite the Mobil station", latitude: 6.4318, longitude: 3.4215 },
    })
  })

  test("is null for an address without a pin: the buyer places one before delivering there", () => {
    expect(checkoutAddressOf({ ...home, metadata: { landmark: "Opposite the Mobil station" } }, "NG")).toBeNull()
  })

  test("is null for an address the country's form wouldn't take, e.g. one without an LGA", () => {
    expect(checkoutAddressOf({ ...home, city: null }, "NG")).toBeNull()
  })
})

describe("preselectedAddress", () => {
  test("is the buyer's default address", () => {
    expect(preselectedAddress([office, home], "NG")).toEqual({ id: "caddr_home", address: checkoutAddressOf(home, "NG")! })
  })

  test("is none without a default, rather than guessing which one the buyer means", () => {
    expect(preselectedAddress([{ ...home, is_default_shipping: false }, office], "NG")).toBeNull()
    expect(preselectedAddress([], "NG")).toBeNull()
  })

  test("is none when the default has no pin yet", () => {
    expect(preselectedAddress([{ ...home, metadata: {} }, office], "NG")).toBeNull()
  })
})

describe("savedAddressEdit", () => {
  test("sends a landmark the buyer cleared as empty, which is how the store removes it", () => {
    const edited = checkoutAddressOf({ ...home, metadata: office.metadata }, "NG")!

    expect(savedAddressEdit(edited, "NG").metadata).toEqual({ landmark: "", latitude: 6.4302, longitude: 3.4178 })
  })

  test("sends the address as it is otherwise", () => {
    const edited = checkoutAddressOf(home, "NG")!

    expect(savedAddressEdit(edited, "NG")).toEqual(edited)
  })
})

describe("addressBook", () => {
  test("lists the default first, the rest in the order they were saved", () => {
    const shop = { ...office, id: "caddr_shop" }

    expect(addressBook([office, shop, home]).map((a) => a.id)).toEqual(["caddr_home", "caddr_office", "caddr_shop"])
  })
})

describe("savedAddressFor", () => {
  /** Ada's office as checkout put it on her cart, with the code Shipbubble validated it as. */
  const onCart = {
    ...office,
    id: "caaddr_1",
    metadata: { ...office.metadata, shipbubble_address_code: 41_525_871 },
  }

  test("is the saved address the cart delivers to", () => {
    expect(savedAddressFor([home, office], onCart, "NG")).toBe("caddr_office")
  })

  test("is none when the cart's address differs from every saved one, even only by its pin", () => {
    const moved = { ...onCart, metadata: { ...onCart.metadata, latitude: 6.4401 } }

    expect(savedAddressFor([home, office], moved, "NG")).toBeNull()
    expect(savedAddressFor([home, office], { ...onCart, address_2: "Floor 2" }, "NG")).toBeNull()
    expect(savedAddressFor([home, office], null, "NG")).toBeNull()
  })
})
