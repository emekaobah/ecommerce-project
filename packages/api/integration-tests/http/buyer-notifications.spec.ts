import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import seedDemoData from "../../src/scripts/seed"
import { rejectOverdueOrders } from "../../src/lib/order-acceptance"
import { ADDRESS, buyerCheckout, eventually, GADGETS, GROCERY, LANTERN, ORDER_TOTALS, RICE, TOTAL, type Shop } from "../helpers/checkout"
import { BEST_VALUE_FEE } from "../helpers/shipbubble"
import { fakeClerk } from "../helpers/clerk"
import { fakeExpoPush, pushToken } from "../helpers/expo-push"
import { fakePaystack } from "../helpers/paystack"
import { fakeResend } from "../helpers/resend"
import { fakeShipbubble } from "../helpers/shipbubble"
import { ALWAYS_OPEN, keepShopsOpen } from "../helpers/shop-hours"
import { formatMoney, WEEKDAYS, type WeeklyHours } from "@oja/domain"
import { setWeeklyHours } from "../../src/lib/shop-hours"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so each fake can be named in the config before it is listening.
const paystack = fakePaystack(52000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(53000 + (process.pid % 1000))
const expo = fakeExpoPush(54000 + (process.pid % 1000))
const resend = fakeResend(55000 + (process.pid % 1000))
// Set before the runner loads medusa-config.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl
process.env.EXPO_ACCESS_TOKEN = expo.accessToken
process.env.EXPO_PUSH_API_URL = expo.apiUrl
process.env.RESEND_API_KEY = resend.apiKey
process.env.RESEND_API_URL = resend.apiUrl
process.env.RESEND_FROM = "Oja <orders@oja.test>"

const ADA = "ada@oja.test"
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start(), expo.start(), resend.start()])
      await seedDemoData({ container: getContainer(), args: [] } as any)
      await keepShopsOpen(getContainer(), [GADGETS, GROCERY])
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop(), expo.stop(), resend.stop()]))
    beforeEach(async () => {
      expo.reset()
      resend.reset()
      await buyer.load()
    })

    /** Ada's device registers for pushes, as the buyer app does once she's signed in. */
    const registerAda = async () => {
      const token = pushToken()
      await api.post("/store/push-tokens", { token }, buyer.ada())
      return token
    }
    /** The pushes a device has had, once at least `count` have arrived. */
    const pushesTo = (token: string, count = 1) => eventually(async () => expo.sentTo(token), (sent) => sent.length >= count)
    /** The emails Ada has had, once at least `count` have arrived. */
    const emailsToAda = (count = 1) => eventually(async () => resend.sentTo(ADA), (sent) => sent.length >= count)
    /** Waits long enough for a push that would have been sent, then says what arrived. */
    const settledPushesTo = async (token: string) => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      return expo.sentTo(token)
    }
    const post = async (shop: Shop, path: string, body = {}) => api.post(`/vendor/orders/${path}`, body, await buyer.owner(shop))
    const shipbubbleSays = (...args: Parameters<typeof shipbubble.webhook>) => {
      const { body, headers } = shipbubble.webhook(...args)
      return api.post("/hooks/shipbubble", body, { headers })
    }
    /** Ada's paid checkout, her phone told it is confirmed: the grocery's order of it, and its group. */
    const confirmedCheckout = async (device: string) => {
      const { cartId, reference } = await buyer.paidCheckout()
      await pushesTo(device)
      return { cartId, reference, orderId: await buyer.shopOrderId(GROCERY, cartId), groupId: await buyer.orderGroupOf(cartId) }
    }
    /** The grocery accepts, picks and packs the order, and books its courier label; returns the waybill. */
    const packAndBook = async (orderId: string) => {
      await post(GROCERY, `${orderId}/accept`)
      const { pick_list } = (await api.get(`/vendor/orders/${orderId}/pick-list`, await buyer.owner(GROCERY))).data
      for (const line of pick_list.lines) await post(GROCERY, `${orderId}/pick-list/${line.id}`, { picked: line.quantity })
      await post(GROCERY, `${orderId}/pack`)
      const { data } = await post(GROCERY, `${orderId}/book-label`)
      return data.fulfilment.shipment.waybill as string
    }
    const displayIdOf = async (entity: "order" | "order_group", id: string) => {
      const { data } = await buyer.query().graph({ entity, fields: ["display_id"], filters: { id } })
      return data[0].display_id as number
    }

    describe("paying for a checkout", () => {
      it("emails Ada her order confirmation and pushes it to her phone, opening the order", async () => {
        const device = await registerAda()

        const { cartId } = await buyer.paidCheckout()

        const groupId = await buyer.orderGroupOf(cartId)
        const group = await displayIdOf("order_group", groupId)
        const [push] = await pushesTo(device)
        expect(push).toMatchObject({
          title: `Order #${group} confirmed`,
          body: "We'll let you know as each of your 2 shops accepts it.",
          data: { url: `/order/${groupId}`, order_group_id: groupId },
        })

        const [email] = await emailsToAda()
        expect(email).toMatchObject({ from: "Oja <orders@oja.test>", subject: `Your Oja order #${group} is confirmed` })
        const grocery = await displayIdOf("order", await buyer.shopOrderId(GROCERY, cartId))
        const gadgets = await displayIdOf("order", await buyer.shopOrderId(GADGETS, cartId))
        const details = [GROCERY.name, `#${grocery}`, RICE.title, GADGETS.name, `#${gadgets}`, LANTERN.title, ADDRESS.address_1]
        const money = (amount: number) => formatMoney(amount, "ngn")
        for (const text of details) expect(email.html).toContain(text)
        for (const text of [...details, `Delivery ${money(BEST_VALUE_FEE)}`, `Total paid ${money(TOTAL)}`]) expect(email.text).toContain(text)
      })

      it("tells Ada a shop that is closed now prepares its order when it opens", async () => {
        // The grocery opens only on the day after tomorrow, at 8am (Lagos time).
        const opensOn = Date.now() + 2 * DAY
        const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Lagos", weekday: "short" }).format(opensOn)
        const hours = { ...Object.fromEntries(WEEKDAYS.map((day) => [day, []])), [weekday.toLowerCase()]: [{ opens: "08:00", closes: "18:00" }] }
        const grocery = await buyer.sellerId(GROCERY)
        await setWeeklyHours(getContainer(), grocery, hours as WeeklyHours)
        const device = await registerAda()

        try {
          await buyer.paidCheckout()

          const prepared = `${GROCERY.name} is closed now: it prepares your order when it opens at 8am ${weekday}.`
          const [push] = await pushesTo(device)
          expect(push.body).toBe(prepared)
          const [email] = await emailsToAda()
          expect(email.text).toContain(prepared)
        } finally {
          await setWeeklyHours(getContainer(), grocery, ALWAYS_OPEN)
        }
      })
    })

    describe("a shop's order moving on", () => {
      it("pushes Ada as it is accepted, its courier booked, picked up and delivered, each opening the order", async () => {
        const device = await registerAda()
        const { orderId, groupId } = await confirmedCheckout(device)
        const order = await displayIdOf("order", orderId)

        const waybill = await packAndBook(orderId)
        await shipbubbleSays(waybill, "confirmed")
        await api.post(`/vendor/orders/${orderId}/hand-over`, {}, await buyer.owner(GROCERY))
        await shipbubbleSays(waybill, "picked_up")
        await shipbubbleSays(waybill, "in_transit")
        await shipbubbleSays(waybill, "completed")

        const pushes = (await pushesTo(device, 5)).slice(1)
        expect(pushes.map(({ title }) => title)).toEqual([
          `Order #${order} accepted`,
          `Courier booked for order #${order}`,
          `Order #${order} picked up`,
          `Order #${order} delivered`,
        ])
        for (const push of pushes) expect(push.data).toEqual({ url: `/order/${groupId}`, order_group_id: groupId, order_id: orderId })
        // Picking, packing, the courier confirming and the parcel in transit are the shop's and courier's own steps.
        expect(await settledPushesTo(device)).toHaveLength(5)
      })

      it("pushes Ada again when a courier the shipper cancelled is rebooked", async () => {
        const device = await registerAda()
        const { orderId } = await confirmedCheckout(device)
        const waybill = await packAndBook(orderId)
        await pushesTo(device, 3)

        await shipbubbleSays(waybill, "cancelled")
        await post(GROCERY, `${orderId}/book-label`)

        const pushes = await pushesTo(device, 4)
        expect(pushes.map(({ title }) => title).slice(2)).toEqual([
          `Courier booked for order #${await displayIdOf("order", orderId)}`,
          `Courier booked for order #${await displayIdOf("order", orderId)}`,
        ])
      })

      it("pushes Ada when the shop rejects her order, and says it is refunded", async () => {
        const device = await registerAda()
        const { orderId } = await confirmedCheckout(device)

        await post(GROCERY, `${orderId}/reject`, { reason: "Out of stock" })

        const [, push] = await pushesTo(device, 2)
        expect(push).toMatchObject({
          title: `Order #${await displayIdOf("order", orderId)} cancelled`,
          body: `${GROCERY.name} couldn't take your order. You'll get a full refund.`,
        })
      })

      it("pushes Ada when a shop doesn't accept her order in time", async () => {
        const device = await registerAda()
        const { cartId, orderId } = await confirmedCheckout(device)
        await post(GADGETS, `${await buyer.shopOrderId(GADGETS, cartId)}/accept`)
        await pushesTo(device, 2)

        // The shops are open round the clock, so 24 open hours have passed.
        await rejectOverdueOrders(getContainer(), new Date(Date.now() + 25 * HOUR))

        const [, , push] = await pushesTo(device, 3)
        expect(push).toMatchObject({
          title: `Order #${await displayIdOf("order", orderId)} cancelled`,
          body: `${GROCERY.name} didn't accept your order in time. You'll get a full refund.`,
        })
      })
    })

    describe("items the shop didn't have", () => {
      it("pushes Ada which shop removed them and what she is refunded, opening the order", async () => {
        const device = await registerAda()
        const { orderId, groupId } = await confirmedCheckout(device)
        await post(GROCERY, `${orderId}/accept`)
        const { pick_list } = (await api.get(`/vendor/orders/${orderId}/pick-list`, await buyer.owner(GROCERY))).data
        await post(GROCERY, `${orderId}/pick-list/${pick_list.lines[0].id}/unavailable`, { quantity: 1 })

        await post(GROCERY, `${orderId}/remove-unavailable`)

        const [, , push] = await pushesTo(device, 3)
        expect(push).toMatchObject({
          title: `Items removed from order #${await displayIdOf("order", orderId)}`,
          body: `${GROCERY.name} didn't have 1 × ${RICE.title}. You'll be refunded ${formatMoney(RICE.price, "ngn")}.`,
          data: { url: `/order/${groupId}`, order_group_id: groupId, order_id: orderId },
        })
      })
    })

    describe("a refund Paystack has processed", () => {
      it("pushes Ada once that her refund has completed, and nothing for one still pending or failed", async () => {
        const device = await registerAda()
        const { cartId, reference, orderId } = await confirmedCheckout(device)
        await post(GROCERY, `${orderId}/reject`, { reason: "Out of stock" })
        await post(GADGETS, `${await buyer.shopOrderId(GADGETS, cartId)}/reject`, { reason: "Closed for stock-taking" })
        await pushesTo(device, 3)
        const refundOf = (shopTotal: number) => paystack.refundsOf(reference).find((r) => r.amount === shopTotal * 100)!
        const grocery = refundOf(ORDER_TOTALS.get(GROCERY)!)
        const gadgets = refundOf(ORDER_TOTALS.get(GADGETS)!)

        // Still pending: nothing to tell.
        await buyer.postWebhook(paystack.refundEvent(grocery.id))
        expect(await settledPushesTo(device)).toHaveLength(3)

        paystack.settleRefund(grocery.id, "processed")
        paystack.settleRefund(gadgets.id, "failed")
        await buyer.postWebhook(paystack.refundEvent(grocery.id))
        await buyer.postWebhook(paystack.refundEvent(gadgets.id))
        // Paystack sends a webhook again when it isn't sure we got it.
        await buyer.postWebhook(paystack.refundEvent(grocery.id))

        const [, , , push] = await pushesTo(device, 4)
        expect(push).toMatchObject({
          title: `Refund for order #${await displayIdOf("order", orderId)} completed`,
          body: `The refund of ${formatMoney(ORDER_TOTALS.get(GROCERY)!, "ngn")} from ${GROCERY.name} has completed.`,
          data: { order_id: orderId },
        })
        expect(await settledPushesTo(device)).toHaveLength(4)
      })
    })

    describe("an order delivered", () => {
      it("emails Ada her receipt for the shop's order", async () => {
        const device = await registerAda()
        const { orderId, groupId } = await confirmedCheckout(device)
        const waybill = await packAndBook(orderId)
        await shipbubbleSays(waybill, "confirmed")
        await api.post(`/vendor/orders/${orderId}/hand-over`, {}, await buyer.owner(GROCERY))
        await shipbubbleSays(waybill, "picked_up")

        await shipbubbleSays(waybill, "completed")

        const [, receipt] = await emailsToAda(2)
        const order = await displayIdOf("order", orderId)
        expect(receipt).toMatchObject({ subject: `Your Oja receipt: order #${order} from ${GROCERY.name}` })
        for (const text of [GROCERY.name, `#${order}`, RICE.title, `order #${await displayIdOf("order_group", groupId)}`]) {
          expect(receipt.html).toContain(text)
        }
        // Only the delivered shop's order is on it.
        expect(receipt.html).not.toContain(LANTERN.title)
      })
    })
  },
})
