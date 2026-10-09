import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import seedDemoData from "../../src/scripts/seed"
import { SEED_PASSWORD } from "../../src/scripts/seed-data"
import { alertHandoverDisagreements } from "../../src/lib/handover"
import { fulfilmentsOf } from "../../src/lib/order-fulfilment"
import { vendorHeaders } from "../helpers/auth"
import { buyerCheckout, eventually, GADGETS, GROCERY, type Shop } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakeExpoPush, pushToken } from "../helpers/expo-push"
import { fakePaystack } from "../helpers/paystack"
import { COURIERS, fakeShipbubble } from "../helpers/shipbubble"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so each fake can be named in the config before it is listening.
const paystack = fakePaystack(63000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(64000 + (process.pid % 1000))
const expo = fakeExpoPush(46000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers each provider only when its key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl
process.env.EXPO_ACCESS_TOKEN = expo.accessToken
process.env.EXPO_PUSH_API_URL = expo.apiUrl

const HOUR = 60 * 60 * 1000

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })
    const status = (request: Promise<unknown>) =>
      request.then(
        () => 200,
        (e: any) => e.response?.status as number
      )

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start(), expo.start()])
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop(), expo.stop()]))
    beforeEach(async () => {
      shipbubble.reset()
      expo.reset()
      await buyer.load()
    })

    /** The shop's fulfilment staff member (Kunle, at the grocery), not its owner. */
    const staff = async (shop: Shop) => vendorHeaders(api, shop.staff.email, SEED_PASSWORD, await buyer.sellerId(shop))
    const post = async (shop: Shop, path: string, body = {}) => api.post(`/vendor/orders/${path}`, body, await buyer.owner(shop))
    const order = async (orderId: string, shop = GROCERY) =>
      (await api.get(`/vendor/orders/${orderId}`, await buyer.owner(shop))).data.order
    const handOver = async (orderId: string, shop = GROCERY) => api.post(`/vendor/orders/${orderId}/hand-over`, {}, await staff(shop))
    const shipbubbleSays = (...args: Parameters<typeof shipbubble.webhook>) => {
      const { body, headers } = shipbubble.webhook(...args)
      return api.post("/hooks/shipbubble", body, { headers })
    }

    /** The grocery shop's order of Ada's paid checkout, packed, its label booked; and the order's group and waybill. */
    const bookedOrder = async () => {
      const { cartId } = await buyer.paidCheckout()
      const orderId = await buyer.shopOrderId(GROCERY, cartId)
      await post(GROCERY, `${orderId}/accept`)
      await post(GROCERY, `${orderId}/start-picking`)
      const { pick_list } = (await api.get(`/vendor/orders/${orderId}/pick-list`, await buyer.owner(GROCERY))).data
      for (const line of pick_list.lines) await post(GROCERY, `${orderId}/pick-list/${line.id}`, { picked: line.quantity })
      await post(GROCERY, `${orderId}/pack`)
      const { data } = await post(GROCERY, `${orderId}/book-label`)
      return { orderId, groupId: await buyer.orderGroupOf(cartId), waybill: data.fulfilment.shipment.waybill as string }
    }
    /** As `bookedOrder`, with the courier's pickup confirmed. */
    const confirmedOrder = async () => {
      const booked = await bookedOrder()
      await shipbubbleSays(booked.waybill, "confirmed")
      return booked
    }
    /** As `confirmedOrder`, handed to the courier: staff tapped and the courier picked it up. */
    const handedOverOrder = async () => {
      const confirmed = await confirmedOrder()
      await handOver(confirmed.orderId)
      await shipbubbleSays(confirmed.waybill, "picked_up")
      return confirmed
    }
    const payoutEligibleAt = async (orderId: string) => (await fulfilmentsOf(getContainer(), [orderId])).get(orderId)?.payout_eligible_at ?? null

    describe("handing the parcel to the courier", () => {
      it("records which staff member handed it over and when, and waits for the courier to report the pickup", async () => {
        const { orderId, waybill } = await confirmedOrder()
        const before = Date.now()

        const { data } = await handOver(orderId)

        expect(data.fulfilment).toMatchObject({
          state: "courier_confirmed",
          handover: { staff: { name: `${GROCERY.staff.first_name} ${GROCERY.staff.last_name}` }, picked_up_at: null },
        })
        expect(new Date(data.fulfilment.handover.staff.at).getTime()).toBeGreaterThanOrEqual(before)
        // Kept with the member's id, for the record.
        const stored = (await fulfilmentsOf(getContainer(), [orderId])).get(orderId)!
        expect(stored.fulfilment).toMatchObject({ handover: { staff: { actor: expect.stringMatching(/^mem/) } } })

        await shipbubbleSays(waybill, "picked_up")

        const handed = (await order(orderId)).fulfilment
        expect(handed).toMatchObject({ state: "handed_to_courier", handover: { staff: data.fulfilment.handover.staff } })
        expect(handed.handover.picked_up_at).toEqual(expect.any(String))
      })

      it("isn't complete on the courier's word alone: the order waits for staff to confirm it", async () => {
        const { orderId, waybill } = await confirmedOrder()

        await shipbubbleSays(waybill, "picked_up")
        expect((await order(orderId)).fulfilment).toMatchObject({ state: "courier_confirmed", handover: { staff: null } })

        const { data } = await handOver(orderId)
        expect(data.fulfilment.state).toBe("handed_to_courier")
      })

      it("counts a pickup Shipbubble reports before its confirmation arrives", async () => {
        const { orderId, waybill } = await bookedOrder()

        await shipbubbleSays(waybill, "picked_up")
        // The late confirmation changes nothing more.
        expect((await shipbubbleSays(waybill, "confirmed")).status).toBe(200)
        expect((await order(orderId)).fulfilment).toMatchObject({ state: "courier_confirmed", handover: { staff: null } })

        const { data } = await handOver(orderId)
        expect(data.fulfilment.state).toBe("handed_to_courier")
      })

      it("is refused before the courier confirms, a second time, and for another shop's order", async () => {
        const { orderId, waybill } = await bookedOrder()

        expect(await status(handOver(orderId))).toBe(400)
        await shipbubbleSays(waybill, "confirmed")
        await handOver(orderId)
        expect(await status(handOver(orderId))).toBe(400)
        expect(await status(handOver(orderId, GADGETS))).toBe(404)
      })
    })

    describe("in transit and delivered", () => {
      it("follow Shipbubble's in_transit and completed; delivered makes the order payout-eligible", async () => {
        const { orderId, waybill } = await handedOverOrder()

        await shipbubbleSays(waybill, "in_transit")
        expect((await order(orderId)).fulfilment.state).toBe("in_transit")
        expect(await payoutEligibleAt(orderId)).toBeNull()

        const before = Date.now()
        await shipbubbleSays(waybill, "completed")

        expect((await order(orderId)).fulfilment.state).toBe("delivered")
        expect(new Date((await payoutEligibleAt(orderId))!).getTime()).toBeGreaterThanOrEqual(before)
        // The order's Medusa fulfilment is delivered too, as the web panels show it.
        const { data } = await buyer.query().graph({ entity: "order", fields: ["fulfillments.delivered_at"], filters: { id: orderId } })
        expect(data[0].fulfillments![0]!.delivered_at).toBeTruthy()
      })

      it("aren't taken before the handover is complete; the staff tap then catches the order up with the courier", async () => {
        const { orderId, waybill } = await confirmedOrder()

        await shipbubbleSays(waybill, "picked_up")
        await shipbubbleSays(waybill, "in_transit")
        await shipbubbleSays(waybill, "completed")
        expect((await order(orderId)).fulfilment.state).toBe("courier_confirmed")
        expect(await payoutEligibleAt(orderId)).toBeNull()

        const { data } = await handOver(orderId)

        expect(data.fulfilment.state).toBe("delivered")
        expect(await payoutEligibleAt(orderId)).not.toBeNull()
      })

      it("are acknowledged and ignored when repeated", async () => {
        const { orderId, waybill } = await handedOverOrder()
        await shipbubbleSays(waybill, "in_transit")

        expect((await shipbubbleSays(waybill, "in_transit")).status).toBe(200)
        expect((await shipbubbleSays(waybill, "picked_up")).status).toBe(200)
        expect((await order(orderId)).fulfilment.state).toBe("in_transit")
      })
    })

    describe("an order cancelled meanwhile", () => {
      it("takes no more courier updates and is never payout-eligible", async () => {
        const { orderId, waybill } = await handedOverOrder()
        await shipbubbleSays(waybill, "in_transit")
        await getContainer().resolve(Modules.ORDER).cancel(orderId)

        expect((await shipbubbleSays(waybill, "completed")).status).toBe(200)

        expect((await order(orderId)).fulfilment.state).toBe("in_transit")
        expect(await payoutEligibleAt(orderId)).toBeNull()
      })

      it("refuses the staff handover", async () => {
        const { orderId } = await confirmedOrder()
        await getContainer().resolve(Modules.ORDER).cancel(orderId)

        expect(await status(handOver(orderId))).toBe(400)
      })
    })

    describe("staff and the courier disagreeing about the handover", () => {
      /** The owner's and the staff member's phones, registered for the shop's pushes. */
      const devices = async (shop: Shop) => {
        const owner = pushToken()
        const staffPhone = pushToken()
        await api.post("/vendor/push-tokens", { token: owner }, await buyer.owner(shop))
        await api.post("/vendor/push-tokens", { token: staffPhone }, await staff(shop))
        return { owner, staffPhone }
      }

      /** The handover alerts a device has had. */
      const handoverAlertsTo = (token: string) => expo.sentTo(token).filter((m) => /handover/i.test(m.title ?? ""))

      it("alerts the owner, once that day, when staff handed over and the courier hasn't reported the pickup two hours later", async () => {
        const phones = await devices(GROCERY)
        const { orderId } = await confirmedOrder()
        await handOver(orderId)
        const now = Date.now()

        await alertHandoverDisagreements(getContainer(), new Date(now + HOUR))
        await alertHandoverDisagreements(getContainer(), new Date(now + 2 * HOUR + 60_000))
        await alertHandoverDisagreements(getContainer(), new Date(now + 3 * HOUR))

        const [alert, ...more] = await eventually(async () => handoverAlertsTo(phones.owner), (s) => s.length > 0)
        expect(more).toEqual([])
        expect(alert).toMatchObject({
          title: expect.stringMatching(/^Check the handover of order #\d+$/),
          body: expect.stringMatching(/hasn't reported picking it up/),
          data: { url: `/orders/${orderId}` },
        })
        // Owners only: fulfilment staff aren't told.
        await new Promise((resolve) => setTimeout(resolve, 500))
        expect(handoverAlertsTo(phones.staffPhone)).toEqual([])
        expect(handoverAlertsTo(phones.owner)).toHaveLength(1)
      })

      it("alerts the owner again each day while staff and the courier still disagree", async () => {
        const phones = await devices(GROCERY)
        const { orderId } = await confirmedOrder()
        await handOver(orderId)
        const first = Date.now() + 3 * HOUR

        await alertHandoverDisagreements(getContainer(), new Date(first))
        await eventually(async () => handoverAlertsTo(phones.owner), (s) => s.length === 1)
        await alertHandoverDisagreements(getContainer(), new Date(first + 23 * HOUR))
        await alertHandoverDisagreements(getContainer(), new Date(first + 24 * HOUR))

        const alerts = await eventually(async () => handoverAlertsTo(phones.owner), (s) => s.length >= 2)
        await new Promise((resolve) => setTimeout(resolve, 500))
        expect(handoverAlertsTo(phones.owner)).toHaveLength(2)
        expect(alerts.every((m) => m.data?.url === `/orders/${orderId}`)).toBe(true)
      })

      it("alerts the owner when the courier picked it up and no one confirmed the handover", async () => {
        const phones = await devices(GROCERY)
        const { orderId, waybill } = await confirmedOrder()
        await shipbubbleSays(waybill, "picked_up")

        await alertHandoverDisagreements(getContainer(), new Date(Date.now() + 3 * HOUR))

        const [alert] = await eventually(async () => handoverAlertsTo(phones.owner), (s) => s.length > 0)
        expect(alert).toMatchObject({ body: expect.stringMatching(/no one confirmed handing it over/), data: { url: `/orders/${orderId}` } })
      })

      it("doesn't alert once both halves agree", async () => {
        const phones = await devices(GROCERY)
        await handedOverOrder()

        await alertHandoverDisagreements(getContainer(), new Date(Date.now() + 3 * HOUR))

        await new Promise((resolve) => setTimeout(resolve, 500))
        expect(handoverAlertsTo(phones.owner)).toEqual([])
      })
    })

    describe("the buyer's tracking", () => {
      it("shows the buyer the order's timeline and the courier's tracking link, without who handed it over", async () => {
        const { orderId, groupId, waybill } = await handedOverOrder()
        await shipbubbleSays(waybill, "in_transit")

        const { order_group } = (await api.get(`/store/order-history/${groupId}`, buyer.ada())).data
        const shopOrder = order_group.orders.find((o: any) => o.id === orderId)

        expect(shopOrder.fulfilment).toMatchObject({
          state: "in_transit",
          shipment: { courier_name: COURIERS.nextDay.courier_name, tracking_url: shipbubble.shipment(waybill)!.tracking_url, cancelled: false },
        })
        expect(shopOrder.fulfilment.timeline.map((s: any) => [s.label, s.status])).toEqual([
          ["Order placed", "done"],
          ["Accepted", "done"],
          ["Being prepared", "done"],
          ["Packed", "done"],
          ["Courier booked", "done"],
          ["Picked up by the courier", "done"],
          ["On its way", "current"],
          ["Delivered", "upcoming"],
        ])
        expect(shopOrder.fulfilment.timeline.filter((s: any) => s.status !== "upcoming").every((s: any) => !!s.at)).toBe(true)
        expect(shopOrder.fulfilment).not.toHaveProperty("handover")
      })
    })
  },
})
