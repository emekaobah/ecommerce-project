import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import seedDemoData from "../../src/scripts/seed"
import { adminHeaders } from "../helpers/auth"
import { buyerCheckout, eventually, GROCERY } from "../helpers/checkout"
import { statusOf } from "../helpers/checkout-suite"
import { fakeClerk } from "../helpers/clerk"
import { fakeExpoPush, pushToken } from "../helpers/expo-push"
import { fakePaystack } from "../helpers/paystack"
import { fakeResend } from "../helpers/resend"
import { COURIERS, fakeShipbubble, type FakeCourier } from "../helpers/shipbubble"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so each fake can be named in the config before it is listening.
const paystack = fakePaystack(14000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(15000 + (process.pid % 1000))
const expo = fakeExpoPush(16000 + (process.pid % 1000))
const resend = fakeResend(17000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers each provider only when its key is set.
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
/** Ada chose best value at checkout: GIG Next Day. */
const CHOSEN = COURIERS.nextDay
/** Arrives sooner than Ada's courier for ₦500 more: within the default ₦1,000 top-up cap. */
const FARAMOVE: FakeCourier = { courier_id: "faramove", courier_name: "Faramove Same Day", service_code: "faramove", amount: 3000, hours: 20, tracking_level: 6 }

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start(), expo.start(), resend.start()])
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop(), expo.stop(), resend.stop()]))
    beforeEach(async () => {
      shipbubble.reset()
      expo.reset()
      resend.reset()
      await buyer.load()
    })

    const post = async (path: string, body = {}) => api.post(`/vendor/orders/${path}`, body, await buyer.owner(GROCERY))
    const order = async (orderId: string) => (await api.get(`/vendor/orders/${orderId}`, await buyer.owner(GROCERY))).data.order
    const bookLabel = (orderId: string, body = {}) => post(`${orderId}/book-label`, body)

    /** Ada's device, registered for pushes. */
    const registerAda = async () => {
      const token = pushToken()
      await api.post("/store/push-tokens", { token }, buyer.ada())
      return token
    }
    /** The pushes and emails Ada has had about her courier changing. */
    const switchPushesTo = (token: string) => expo.sentTo(token).filter((m) => m.title?.startsWith("New courier"))
    const switchEmailsToAda = () => resend.sentTo(ADA).filter((e) => e.subject.includes("new courier"))

    /** The grocery's order of Ada's paid checkout (two bags of rice, GIG Next Day), accepted, picked and packed, and its cart. */
    const packedOrder = async () => {
      const { cartId } = await buyer.paidCheckout()
      const orderId = await buyer.shopOrderId(GROCERY, cartId)
      await post(`${orderId}/accept`)
      await post(`${orderId}/start-picking`)
      const { pick_list } = (await api.get(`/vendor/orders/${orderId}/pick-list`, await buyer.owner(GROCERY))).data
      for (const line of pick_list.lines) await post(`${orderId}/pick-list/${line.id}`, { picked: line.quantity })
      await post(`${orderId}/pack`)
      return { orderId, cartId }
    }
    /** The grocery's order as Ada sees it in her order history. */
    const adasOrder = async (cartId: string, orderId: string) => {
      const groupId = await buyer.orderGroupOf(cartId)
      const { order_group } = (await api.get(`/store/order-history/${groupId}`, buyer.ada())).data
      return order_group.orders.find((o: any) => o.id === orderId)
    }

    describe("a courier other than the buyer's, within the top-up cap", () => {
      it("is booked, recording both couriers and the difference, and Ada is told by push and email", async () => {
        const device = await registerAda()
        const { orderId, cartId } = await packedOrder()
        // GIG no longer quotes; Faramove arrives sooner for ₦500 more.
        shipbubble.setCouriers([COURIERS.bike, FARAMOVE, COURIERS.slow])

        const { data } = await bookLabel(orderId)

        expect(data.courier_options).toBeNull()
        expect(shipbubble.labelRequests()).toMatchObject([{ courier_id: FARAMOVE.courier_id }])
        expect(data.fulfilment).toMatchObject({
          state: "label_booked",
          shipment: {
            courier_name: FARAMOVE.courier_name,
            switched_from: CHOSEN.courier_name,
            price: { checkout: CHOSEN.amount, booked: FARAMOVE.amount, difference: 500 },
          },
        })
        expect((await order(orderId)).fulfilment).toEqual(data.fulfilment)

        const [push] = await eventually(async () => switchPushesTo(device), (sent) => sent.length > 0)
        expect(push.body).toContain(FARAMOVE.courier_name)
        expect(push.body).toMatch(/Arrives/)
        const [email] = await eventually(async () => switchEmailsToAda(), (sent) => sent.length > 0)
        expect(email.text).toContain(`now shipping with ${FARAMOVE.courier_name}`)
        expect(email.text).toContain(CHOSEN.courier_name)
        // GIG no longer quoting isn't the only reason couriers change: staff may choose another.
        expect(email.text).not.toContain("couldn't")
        // Told once about the courier, not also that a courier was booked.
        expect(expo.sentTo(device).filter((m) => m.title?.startsWith("Courier booked"))).toEqual([])

        expect((await adasOrder(cartId, orderId)).delivery).toMatchObject({
          courier_name: FARAMOVE.courier_name,
          switched_from: CHOSEN.courier_name,
        })
      })
    })

    const admin = () => adminHeaders(getContainer(), api)
    const approvals = async () => (await api.get("/admin/courier-approvals", await admin())).data
    /** The admin's notifications about a courier to approve for the order. */
    const adminNoticesAbout = async (orderId: string) => {
      const { data: orders } = await buyer.query().graph({ entity: "order", fields: ["display_id"], filters: { id: orderId } })
      const { data } = await buyer.query().graph({ entity: "notification", fields: ["data"], filters: { channel: "feed" } })
      return data.filter((n: any) => n.data?.title === `Courier for order #${orders[0].display_id} to approve`)
    }

    describe("a courier costing more than the cap above the buyer's", () => {
      /** Ada's packed order, once GIG no longer quotes: Express arrives in time for ₦1,700 more; Bike, later, costs ₦700 less. */
      const packedOverCap = async () => {
        const packed = await packedOrder()
        shipbubble.setCouriers([COURIERS.bike, COURIERS.express])
        return packed
      }

      it("isn't booked by itself: the couriers quoting now come back for staff to choose from", async () => {
        const { orderId } = await packedOverCap()

        const { data } = await bookLabel(orderId)

        expect(shipbubble.labelRequests()).toEqual([])
        expect(data.fulfilment).toMatchObject({ state: "packed", shipment: null, courier_approval: null })
        expect(data.courier_options).toEqual([
          expect.objectContaining({ courier_id: COURIERS.bike.courier_id, amount: COURIERS.bike.amount, difference: -700, within_cap: true }),
          expect.objectContaining({ courier_id: COURIERS.express.courier_id, amount: COURIERS.express.amount, difference: 1700, within_cap: false }),
        ])
      })

      it("staff choosing one within the cap books it", async () => {
        const { orderId } = await packedOverCap()

        const { data } = await bookLabel(orderId, { courier: { courier_id: COURIERS.bike.courier_id, service_code: COURIERS.bike.service_code } })

        expect(shipbubble.labelRequests()).toMatchObject([{ courier_id: COURIERS.bike.courier_id }])
        expect(data.fulfilment).toMatchObject({
          state: "label_booked",
          shipment: { courier_name: COURIERS.bike.courier_name, switched_from: CHOSEN.courier_name, price: { difference: -700 } },
        })
      })

      it("staff choosing one above the cap waits for Oja's approval, then books it once approved, and Ada is told", async () => {
        const device = await registerAda()
        const { orderId } = await packedOverCap()
        const express = { courier_id: COURIERS.express.courier_id, service_code: COURIERS.express.service_code }

        const { data } = await bookLabel(orderId, { courier: express })

        // Nothing booked yet: the order waits for Oja's team, who are notified.
        expect(shipbubble.labelRequests()).toEqual([])
        expect(data.fulfilment).toMatchObject({
          state: "packed",
          courier_approval: { courier_name: COURIERS.express.courier_name, amount: COURIERS.express.amount, checkout_amount: CHOSEN.amount, difference: 1700 },
        })
        expect(await adminNoticesAbout(orderId)).toHaveLength(1)
        expect((await approvals()).courier_approvals).toEqual([
          expect.objectContaining({ order_id: orderId, shop: GROCERY.name, courier: expect.objectContaining({ courier_id: express.courier_id, difference: 1700 }) }),
        ])

        const { data: approved } = await api.post(`/admin/courier-approvals/${orderId}/approve`, {}, await admin())

        expect(shipbubble.labelRequests()).toMatchObject([express])
        expect(approved.fulfilment).toMatchObject({
          state: "label_booked",
          courier_approval: null,
          shipment: { courier_name: COURIERS.express.courier_name, switched_from: CHOSEN.courier_name, price: { difference: 1700 } },
        })
        expect((await order(orderId)).fulfilment).toMatchObject({ state: "label_booked", courier_approval: null })
        expect((await approvals()).courier_approvals).toEqual([])
        const [push] = await eventually(async () => switchPushesTo(device), (sent) => sent.length > 0)
        expect(push.body).toContain(COURIERS.express.courier_name)
        const [email] = await eventually(async () => switchEmailsToAda(), (sent) => sent.length > 0)
        expect(email.text).toContain(`now shipping with ${COURIERS.express.courier_name}`)
        expect(email.text).toContain(CHOSEN.courier_name)
      })

      it("isn't booked once approved if it now costs more than staff asked for: Oja's team decline it", async () => {
        const { orderId } = await packedOverCap()
        await bookLabel(orderId, { courier: { courier_id: COURIERS.express.courier_id, service_code: COURIERS.express.service_code } })
        shipbubble.setCouriers([COURIERS.bike, { ...COURIERS.express, amount: COURIERS.express.amount + 500 }])

        const refused = await api.post(`/admin/courier-approvals/${orderId}/approve`, {}, await admin()).catch((e) => e.response)

        expect(refused.status).toBe(400)
        expect(refused.data.message).toMatch(/more than the .* asked for\. Decline it/)
        expect(shipbubble.labelRequests()).toEqual([])
        expect((await approvals()).courier_approvals).toEqual([expect.objectContaining({ order_id: orderId })])
      })

      it("declined by Oja's team leaves the order packed for staff to choose again", async () => {
        const { orderId } = await packedOverCap()
        await bookLabel(orderId, { courier: { courier_id: COURIERS.express.courier_id, service_code: COURIERS.express.service_code } })

        const { data } = await api.post(`/admin/courier-approvals/${orderId}/decline`, {}, await admin())

        expect(data.fulfilment).toMatchObject({ state: "packed", courier_approval: null })
        expect((await approvals()).courier_approvals).toEqual([])
        expect(await statusOf(api.post(`/admin/courier-approvals/${orderId}/approve`, {}, await admin()))).toBe(404)
        expect(shipbubble.labelRequests()).toEqual([])
      })

      it("is booked by itself once Oja's team raise the cap to cover it", async () => {
        const { orderId } = await packedOverCap()
        expect((await approvals()).top_up_cap).toBe(1000)

        await api.post("/admin/courier-approvals/cap", { top_up_cap: 2000 }, await admin())
        try {
          expect((await approvals()).top_up_cap).toBe(2000)
          const { data } = await bookLabel(orderId)

          expect(data.courier_options).toBeNull()
          expect(data.fulfilment).toMatchObject({ state: "label_booked", shipment: { courier_name: COURIERS.express.courier_name } })
        } finally {
          await api.post("/admin/courier-approvals/cap", { top_up_cap: 1000 }, await admin())
        }
      })

      it("refuses a courier that no longer quotes", async () => {
        const { orderId } = await packedOverCap()

        expect(await statusOf(bookLabel(orderId, { courier: { courier_id: CHOSEN.courier_id, service_code: CHOSEN.service_code } }))).toBe(400)
        expect(shipbubble.labelRequests()).toEqual([])
      })

      it("is approved only by Oja's team, not the shop", async () => {
        const { orderId } = await packedOverCap()
        await bookLabel(orderId, { courier: { courier_id: COURIERS.express.courier_id, service_code: COURIERS.express.service_code } })

        expect(await statusOf(api.post(`/admin/courier-approvals/${orderId}/approve`, {}, await buyer.owner(GROCERY)))).toBe(401)
        expect(await statusOf(api.post("/admin/courier-approvals/cap", { top_up_cap: 50_000 }, await buyer.owner(GROCERY)))).toBe(401)
        expect(shipbubble.labelRequests()).toEqual([])
      })
    })
  },
})
