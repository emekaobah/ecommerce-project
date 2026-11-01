import { describe, expect, test } from "bun:test"
import { buyerActivityContent, buyerActivityUrl } from "./buyer-activity"
import { buyerLiveUpdateMessage, buyerLiveUpdateView, LIVE_UPDATE_TTL_SECONDS, readLiveUpdateMessage } from "./live-update"
import { formatMoney } from "./money"

const order = { number: "OJ-2412", shop: "Iya Bisi Foodstuff", currency_code: "ngn" }
const url = buyerActivityUrl("oja", "group_1", "order_1")
const HOUR = 60 * 60 * 1000

const message = (content: ReturnType<typeof buyerActivityContent>) => buyerLiveUpdateMessage({ action: "show", orderId: "order_1", url, content, at: 1000 })

describe("buyerLiveUpdateView, against the catalogue's drawings", () => {
  test("in progress: the step as the title, the shop and next step as the text, the chip saying the step", () => {
    const view = buyerLiveUpdateView(message(buyerActivityContent({ ...order, method: "delivery", state: "picking" })))
    expect(view).toMatchObject({
      id: "order_1",
      revision: 1000,
      url,
      title: "Being prepared",
      text: "Iya Bisi Foodstuff · Step 3 of 8 · Next: Packed",
      subText: "OJ-2412",
      chip: "3 of 8",
      icon: "box",
      ongoing: true,
      timeoutMs: 12 * HOUR,
      countdownTo: null,
    })
  })

  test("in progress: a segment between steps and a point at each after the first, the tracker where the order is", () => {
    const { progress, olderBar } = buyerLiveUpdateView(message(buyerActivityContent({ ...order, method: "delivery", state: "picking" })))
    expect(progress?.segments).toEqual(Array(7).fill({ length: 1 }))
    expect(progress?.points).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(progress?.position).toBe(2)
    expect(progress?.tracker).toBe("box")
    expect(progress?.styledByProgress).toBe(true)
    // Older Android fills with the step out of the path's steps.
    expect(olderBar).toEqual({ max: 8, current: 3 })
  })

  test("on its way: the tracker and chip become the truck", () => {
    const view = buyerLiveUpdateView(message(buyerActivityContent({ ...order, method: "delivery", state: "in_transit" })))
    expect(view).toMatchObject({ title: "On its way", chip: "7 of 8", icon: "truck", text: "Iya Bisi Foodstuff · Step 7 of 8 · Next: Delivered" })
    expect(view.progress?.tracker).toBe("truck")
  })

  test("ready for pickup: the code in the text and, unspaced, in the chip", () => {
    const view = buyerLiveUpdateView(
      message(buyerActivityContent({ ...order, shop: "Ikeja Gadget Hub", method: "pickup", state: "ready_for_pickup", pickup_code: "482913" }))
    )
    expect(view).toMatchObject({ title: "Ready for pickup", text: "Code 482 913 · Show this code at Ikeja Gadget Hub.", chip: "482913", icon: "store", ongoing: true })
    expect(view.progress).not.toBeNull()
  })

  test("delivered: dismissible, no chip, no bar, and gone after the same short time as on iOS", () => {
    const view = buyerLiveUpdateView(message(buyerActivityContent({ ...order, method: "delivery", state: "delivered" })))
    expect(view).toEqual({
      id: "order_1",
      revision: 1000,
      url,
      title: "Delivered",
      text: "Your order from Iya Bisi Foodstuff has arrived.",
      subText: "OJ-2412",
      chip: null,
      icon: "bag",
      ongoing: false,
      timeoutMs: 30 * 60 * 1000,
      progress: null,
      olderBar: null,
      countdownTo: null,
      color: expect.anything(),
    })
  })

  test("collected says so", () => {
    const view = buyerLiveUpdateView(message(buyerActivityContent({ ...order, method: "pickup", state: "collected" })))
    expect(view.text).toBe("You collected your order from Iya Bisi Foodstuff. Your receipt is in your email.")
  })

  test("not collected says what's refunded and which fresh items aren't", () => {
    const view = buyerLiveUpdateView(
      message(
        buyerActivityContent({ ...order, method: "pickup", state: "not_collected", refund: 12000, kept: [{ title: "Fresh Tomatoes 1kg", quantity: 1 }] })
      )
    )
    expect(view).toMatchObject({ title: "Not collected", ongoing: false, progress: null, chip: null })
    expect(view.text).toBe(`It wasn't collected in time. You'll be refunded ${formatMoney(12000, "ngn")}. Fresh items aren't refunded: 1 × Fresh Tomatoes 1kg.`)
  })

  test("cancelled gives the reason and the refund", () => {
    const view = buyerLiveUpdateView(
      message(buyerActivityContent({ ...order, method: "delivery", state: "cancelled", refund: 5000, cancellation: { by: "seller", reason: "items_unavailable", note: null } }))
    )
    expect(view).toMatchObject({ title: "Cancelled by the shop", ongoing: false, progress: null, chip: null })
    expect(view.text).toBe(`Items unavailable. You'll be refunded ${formatMoney(5000, "ngn")}.`)
  })
})

describe("readLiveUpdateMessage", () => {
  const sent = message(buyerActivityContent({ ...order, method: "delivery", state: "picking" }))

  test("reads what the backend sent, from the JSON string the push carries it in", () => {
    expect(readLiveUpdateMessage({ data: { dataString: JSON.stringify(sent) } })).toEqual(sent)
  })

  test.each([
    ["a normal push's data", { data: { dataString: JSON.stringify({ url: "/order/1" }) } }],
    ["no data string", { data: {} }],
    ["a tap on a notification", { actionIdentifier: "x", notification: {} }],
    ["JSON that doesn't parse", { data: { dataString: "{" } }],
  ])("ignores %s", (_, payload) => {
    expect(readLiveUpdateMessage(payload)).toBeNull()
  })
})

test("a message outlives a delayed phone by no more than the notification would have stayed", () => {
  expect(LIVE_UPDATE_TTL_SECONDS).toBe(12 * 60 * 60)
})
