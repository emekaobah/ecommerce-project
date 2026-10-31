import { describe, expect, test } from "bun:test"
import { cartReminderContent, cartReminderDue, cartReminderPush, type CartReminderCart, type CartReminderLine } from "./cart-reminder"
import { formatMoney } from "./money"

// Lagos is UTC+1 all year.
const lagos = (time: string, day = "2026-10-14") => new Date(`${day}T${time}:00+01:00`)
const HOUR = 60 * 60 * 1000

/** A signed-in buyer's unpaid cart whose items last changed at 10am Lagos time. */
const idle: CartReminderCart = {
  signed_in: true,
  has_items: true,
  paid: false,
  items_changed_at: lagos("10:00").toISOString(),
  reminded: null,
}

describe("cartReminderDue", () => {
  test("is due once its items have been left alone for four hours", () => {
    expect(cartReminderDue(idle, lagos("14:00"))).toBe(true)
  })

  test("isn't due while its items changed less than four hours ago", () => {
    expect(cartReminderDue(idle, lagos("13:59"))).toBe(false)
  })

  test("waits for the delay the schedule sets", () => {
    const schedule = { delay_hours: 2, send_from_hour: 9, send_until_hour: 20, time_zone: "Africa/Lagos" }
    expect(cartReminderDue(idle, lagos("12:00"), schedule)).toBe(true)
    expect(cartReminderDue(idle, lagos("11:59"), schedule)).toBe(false)
  })

  test("isn't due for a guest's cart, an empty cart or a paid one", () => {
    const now = lagos("15:00")
    expect(cartReminderDue({ ...idle, signed_in: false }, now)).toBe(false)
    expect(cartReminderDue({ ...idle, has_items: false }, now)).toBe(false)
    expect(cartReminderDue({ ...idle, paid: true }, now)).toBe(false)
  })

  test("isn't due again once the buyer was reminded after its items last changed", () => {
    const reminded = { ...idle, reminded: { at: lagos("14:00").toISOString(), items_changed_at: idle.items_changed_at } }
    expect(cartReminderDue(reminded, lagos("19:00"))).toBe(false)
    expect(cartReminderDue(reminded, new Date(lagos("14:00").getTime() + 30 * 24 * HOUR))).toBe(false)
  })

  test("is due again once its items changed after the reminder and were left alone again", () => {
    const reminded = { at: lagos("14:00").toISOString(), items_changed_at: idle.items_changed_at }
    const changedSince = { ...idle, reminded, items_changed_at: lagos("15:00").toISOString() }
    expect(cartReminderDue(changedSince, lagos("18:59"))).toBe(false)
    expect(cartReminderDue(changedSince, lagos("19:00"))).toBe(true)
  })

  test("is sent from 9am until 8pm Lagos time", () => {
    const earlier = { ...idle, items_changed_at: lagos("01:00").toISOString() }
    expect(cartReminderDue(earlier, lagos("08:59"))).toBe(false)
    expect(cartReminderDue(earlier, lagos("09:00"))).toBe(true)
    expect(cartReminderDue(earlier, lagos("19:59"))).toBe(true)
    expect(cartReminderDue(earlier, lagos("20:00"))).toBe(false)
  })

  test("a cart left at 11pm is due the next morning, not overnight", () => {
    const lateNight = { ...idle, items_changed_at: lagos("23:00").toISOString() }
    for (const time of ["03:00", "05:00", "08:00"]) expect(cartReminderDue(lateNight, lagos(time, "2026-10-15"))).toBe(false)
    expect(cartReminderDue(lateNight, lagos("09:00", "2026-10-15"))).toBe(true)
  })

  test("a cart falling due after 8pm waits for the morning", () => {
    const evening = { ...idle, items_changed_at: lagos("17:00").toISOString() }
    expect(cartReminderDue(evening, lagos("21:00"))).toBe(false)
    expect(cartReminderDue(evening, lagos("09:00", "2026-10-15"))).toBe(true)
  })

  test("sends in the hours and time zone the schedule sets", () => {
    const london = { delay_hours: 4, send_from_hour: 8, send_until_hour: 22, time_zone: "Europe/London" }
    const earlier = { ...idle, items_changed_at: lagos("01:00").toISOString() }
    // 8am in London on 14 Oct 2026 (BST, UTC+1) is 8am in Lagos.
    expect(cartReminderDue(earlier, lagos("08:00"), london)).toBe(true)
    expect(cartReminderDue(earlier, lagos("21:30"), london)).toBe(true)
    expect(cartReminderDue(earlier, lagos("22:00"), london)).toBe(false)
  })
})

const line = (over: Partial<CartReminderLine> & Pick<CartReminderLine, "product_title">): CartReminderLine => ({
  shop: "Mama Put Groceries",
  variant_title: null,
  quantity: 1,
  added_unit_price: 1000,
  unit_price: 1000,
  available_quantity: null,
  taking_orders: true,
  ...over,
})
const rice = line({ product_title: "Ofada Rice 5kg", quantity: 2, added_unit_price: 8500, unit_price: 8500 })
const lantern = line({ shop: "Lekki Gadgets", product_title: "Rechargeable LED Lantern", added_unit_price: 12000, unit_price: 12000 })
const money = (amount: number) => formatMoney(amount, "ngn")

describe("cartReminderContent", () => {
  test("keeps the lines that can be bought now, with what they cost now and the total", () => {
    expect(cartReminderContent([rice, lantern], "ngn")).toEqual({
      shops: ["Mama Put Groceries", "Lekki Gadgets"],
      items: [
        { shop: "Mama Put Groceries", title: "Ofada Rice 5kg", quantity: 2, unit_price: 8500, total: 17000, price_drop: null, left: null },
        { shop: "Lekki Gadgets", title: "Rechargeable LED Lantern", quantity: 1, unit_price: 12000, total: 12000, price_drop: null, left: null },
      ],
      good_news: null,
      total: 29000,
      currency_code: "ngn",
    })
  })

  test("leaves out sold-out lines, lines of a shop not taking orders, and lines with no price now", () => {
    const content = cartReminderContent(
      [
        { ...rice, available_quantity: 0 },
        { ...lantern, taking_orders: false },
        line({ shop: "Ikeja Books", product_title: "Atlas", unit_price: null }),
        line({ shop: "Yaba Shoes", product_title: "Sandals" }),
      ],
      "ngn"
    )
    expect(content?.shops).toEqual(["Yaba Shoes"])
    expect(content?.items.map((i) => i.title)).toEqual(["Sandals"])
    expect(content?.total).toBe(1000)
  })

  test("is nothing when nothing in the cart can be bought now", () => {
    expect(cartReminderContent([{ ...rice, available_quantity: 0 }, { ...lantern, taking_orders: false }], "ngn")).toBeNull()
    expect(cartReminderContent([], "ngn")).toBeNull()
  })

  test("counts a line wanting more than is left at what is left, as checkout will", () => {
    const content = cartReminderContent([{ ...rice, quantity: 3, available_quantity: 2 }], "ngn")
    expect(content?.items[0]).toMatchObject({ quantity: 2, total: 17000, left: 2 })
    expect(content?.total).toBe(17000)
  })

  test("names a variant beside its product", () => {
    const content = cartReminderContent([line({ product_title: "Ankara Shirt", variant_title: "Large" })], "ngn")
    expect(content?.items[0]?.title).toBe("Ankara Shirt (Large)")
  })

  test("calls out a price that dropped since the line was added", () => {
    const content = cartReminderContent([rice, { ...lantern, unit_price: 10500 }], "ngn")
    expect(content?.items[1]).toMatchObject({ unit_price: 10500, price_drop: 1500 })
    expect(content?.good_news).toBe(`Rechargeable LED Lantern is now ${money(10500)}, down from ${money(12000)}.`)
    expect(content?.total).toBe(17000 + 10500)
  })

  test("calls out a line with only a few left", () => {
    const content = cartReminderContent([{ ...rice, available_quantity: 3 }, lantern], "ngn")
    expect(content?.good_news).toBe("Only 3 left of Ofada Rice 5kg.")
  })

  test("gives one line of good news: a price drop before low stock, the biggest drop, the fewest left", () => {
    const dropped = cartReminderContent(
      [
        { ...rice, available_quantity: 1, unit_price: 8000 },
        { ...lantern, unit_price: 9000 },
      ],
      "ngn"
    )
    expect(dropped?.good_news).toBe(`Rechargeable LED Lantern is now ${money(9000)}, down from ${money(12000)}.`)
    const low = cartReminderContent([{ ...rice, available_quantity: 4 }, { ...lantern, available_quantity: 2 }], "ngn")
    expect(low?.good_news).toBe("Only 2 left of Rechargeable LED Lantern.")
  })

  test("says nothing of a price that rose, plenty left, or a sold-out line", () => {
    const content = cartReminderContent([{ ...rice, unit_price: 9000, available_quantity: 50 }, { ...lantern, available_quantity: 0, unit_price: 6000 }], "ngn")
    expect(content?.good_news).toBeNull()
  })
})

describe("cartReminderPush", () => {
  const push = (lines: CartReminderLine[]) => cartReminderPush(cartReminderContent(lines, "ngn")!)

  test("names the shop and the item left in one shop's cart", () => {
    expect(push([rice])).toEqual({ title: "Your items from Mama Put Groceries", body: "Ofada Rice 5kg is still in your cart." })
  })

  test("names the first shop and counts the others", () => {
    expect(push([rice, lantern]).title).toBe("Your items from Mama Put Groceries and 1 more shop")
    const shoes = line({ shop: "Yaba Shoes", product_title: "Sandals" })
    expect(push([rice, lantern, shoes]).title).toBe("Your items from Mama Put Groceries and 2 more shops")
  })

  test("names the top two items and counts the rest", () => {
    expect(push([rice, lantern]).body).toBe("Ofada Rice 5kg and Rechargeable LED Lantern are still in your cart.")
    const more = [rice, lantern, line({ product_title: "Palm Oil 1L" }), line({ product_title: "Garri 2kg" })]
    expect(push(more).body).toBe("Ofada Rice 5kg, Rechargeable LED Lantern and 2 more are still in your cart.")
  })

  test("adds its one line of good news", () => {
    expect(push([rice, { ...lantern, available_quantity: 2 }]).body).toBe(
      "Ofada Rice 5kg and Rechargeable LED Lantern are still in your cart. Only 2 left of Rechargeable LED Lantern."
    )
  })

  test("leaves out sold-out lines and their shops", () => {
    expect(push([{ ...rice, available_quantity: 0 }, lantern])).toEqual({
      title: "Your items from Lekki Gadgets",
      body: "Rechargeable LED Lantern is still in your cart.",
    })
  })

  test("carries no discount code", () => {
    const { title, body } = push([rice, { ...lantern, unit_price: 9000 }])
    expect(`${title} ${body}`).not.toMatch(/code|% off|discount/i)
  })
})
