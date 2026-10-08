import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import seedDemoData from "../../src/scripts/seed"
import { buyerCheckout, GADGETS, GROCERY, type Shop } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakePaystack } from "../helpers/paystack"
import { COURIERS, fakeShipbubble } from "../helpers/shipbubble"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so each fake can be named in the config before it is listening.
const paystack = fakePaystack(58000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(59000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers each provider only when its key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl

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
      await Promise.all([paystack.start(), shipbubble.start()])
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop()]))
    beforeEach(async () => {
      shipbubble.reset()
      await buyer.load()
    })

    const post = async (shop: Shop, path: string, body = {}) => api.post(`/vendor/orders/${path}`, body, await buyer.owner(shop))
    const order = async (orderId: string, shop = GROCERY) =>
      (await api.get(`/vendor/orders/${orderId}`, await buyer.owner(shop))).data.order
    const bookLabel = (orderId: string, shop = GROCERY) => post(shop, `${orderId}/book-label`)
    /** Shipbubble tells us about a shipment, signed as it signs its webhooks. */
    const shipbubbleSays = (...args: Parameters<typeof shipbubble.webhook>) => {
      const { body, headers } = shipbubble.webhook(...args)
      return api.post("/hooks/shipbubble", body, { headers })
    }
    /** The courier labels on the order's fulfilments, newest last, and whether each was cancelled. */
    const fulfilments = async (orderId: string) => {
      const { data } = await buyer.query().graph({
        entity: "order",
        fields: ["fulfillments.created_at", "fulfillments.canceled_at", "fulfillments.labels.*"],
        filters: { id: orderId },
      })
      return [...(data[0].fulfillments ?? [])]
        .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map((f: any) => ({
          canceled: !!f.canceled_at,
          labels: (f.labels ?? []).map((l: any) => ({ tracking_number: l.tracking_number, tracking_url: l.tracking_url })),
        }))
    }

    /** The grocery shop's order of Ada's paid checkout (two bags of rice, best-value delivery), accepted, picked and packed. */
    const packedOrder = async () => {
      const orderId = await buyer.shopOrderId(GROCERY, (await buyer.paidCheckout()).cartId)
      await post(GROCERY, `${orderId}/accept`)
      await post(GROCERY, `${orderId}/start-picking`)
      const { pick_list } = (await api.get(`/vendor/orders/${orderId}/pick-list`, await buyer.owner(GROCERY))).data
      for (const line of pick_list.lines) await post(GROCERY, `${orderId}/pick-list/${line.id}`, { picked: line.quantity })
      await post(GROCERY, `${orderId}/pack`)
      return orderId
    }

    describe("booking a label", () => {
      it("books the courier the buyer chose for a packed order: label booked, with the waybill on its fulfilment", async () => {
        const orderId = await packedOrder()

        const { data } = await bookLabel(orderId)

        // Paid from the platform's wallet, with a fresh quote for the courier the buyer chose at checkout.
        expect(shipbubble.labelRequests()).toEqual([
          { request_token: expect.any(String), courier_id: COURIERS.nextDay.courier_id, service_code: COURIERS.nextDay.service_code },
        ])
        const waybill = data.fulfilment.shipment.waybill as string
        expect(waybill).toMatch(/^SB-/)
        expect(data.fulfilment).toMatchObject({
          state: "label_booked",
          shipment: {
            waybill,
            courier_name: COURIERS.nextDay.courier_name,
            tracking_url: shipbubble.shipment(waybill)!.tracking_url,
            cancelled: false,
          },
        })
        expect((await order(orderId)).fulfilment).toEqual(data.fulfilment)
        expect(await fulfilments(orderId)).toEqual([
          { canceled: false, labels: [{ tracking_number: waybill, tracking_url: shipbubble.shipment(waybill)!.tracking_url }] },
        ])
      })

      it("refuses an order that isn't packed, and a second label for one already booked", async () => {
        const orderId = await buyer.shopOrderId(GROCERY, (await buyer.paidCheckout()).cartId)
        await post(GROCERY, `${orderId}/accept`)

        expect(await status(bookLabel(orderId))).toBe(400)
        expect((await order(orderId)).fulfilment).toMatchObject({ state: "accepted", shipment: null })

        const packed = await packedOrder()
        await bookLabel(packed)
        expect(await status(bookLabel(packed))).toBe(400)
        expect(shipbubble.labelRequests()).toHaveLength(1)
        expect(await fulfilments(packed)).toHaveLength(1)
      })

      it("leaves the order packed, with no fulfilment, when Shipbubble won't book the label", async () => {
        const orderId = await packedOrder()
        shipbubble.failLabelsWith({ status: 400, message: "Insufficient wallet balance, Please fund your wallet" })

        expect(await status(bookLabel(orderId))).toBeGreaterThanOrEqual(400)

        expect((await order(orderId)).fulfilment).toMatchObject({ state: "packed", shipment: null })
        expect(await fulfilments(orderId)).toEqual([])
      })

      it("is for the order's own shop only", async () => {
        const orderId = await packedOrder()

        expect(await status(bookLabel(orderId, GADGETS))).toBe(404)
        expect(shipbubble.labelRequests()).toEqual([])
      })

      it("is the only way to make or cancel a courier fulfilment: Mercur's own fulfilment routes are closed", async () => {
        const { orderId, waybill } = await bookedOrder()
        const { data } = await buyer.query().graph({ entity: "order", fields: ["items.id", "fulfillments.id"], filters: { id: orderId } })

        expect(await status(post(GROCERY, `${orderId}/fulfillments`, { items: [{ id: data[0].items[0].id, quantity: 1 }] }))).toBe(400)
        expect(await status(post(GROCERY, `${orderId}/fulfillments/${data[0].fulfillments[0].id}/cancel`))).toBe(400)

        expect(shipbubble.cancellations()).toEqual([])
        expect((await order(orderId)).fulfilment).toMatchObject({ state: "label_booked", shipment: { waybill } })
        expect(await fulfilments(orderId)).toHaveLength(1)
      })
    })

    /** A packed order with a label booked, and its waybill. */
    const bookedOrder = async () => {
      const orderId = await packedOrder()
      const { data } = await bookLabel(orderId)
      return { orderId, waybill: data.fulfilment.shipment.waybill as string }
    }

    describe("Shipbubble's webhooks", () => {
      it("move a booked order to courier confirmed when the courier confirms", async () => {
        const { orderId, waybill } = await bookedOrder()

        const { status: answered } = await shipbubbleSays(waybill, "confirmed")

        expect(answered).toBe(200)
        expect((await order(orderId)).fulfilment).toMatchObject({ state: "courier_confirmed", shipment: { waybill, cancelled: false } })
      })

      it("keep a booked order label booked when Shipbubble reports the label created, however often", async () => {
        const { orderId, waybill } = await bookedOrder()

        await shipbubbleSays(waybill, "pending", { event: "shipment.label.created" })
        await shipbubbleSays(waybill, "pending", { event: "shipment.label.created" })

        expect((await order(orderId)).fulfilment.state).toBe("label_booked")
      })

      it("are turned away unless Shipbubble signed them", async () => {
        const { orderId, waybill } = await bookedOrder()
        const { body } = shipbubble.webhook(waybill, "confirmed")
        const send = (headers: Record<string, string>, raw = body) =>
          status(api.post("/hooks/shipbubble", raw, { headers: { "content-type": "application/json", ...headers } }))

        expect(await send({})).toBe(401)
        expect(await send({ "x-ship-signature": shipbubble.sign(body, "sb_sandbox_someone_else") })).toBe(401)
        expect(await send({ "x-ship-signature": "not-hex" })).toBe(401)
        // Signed, then changed on the way.
        const tampered = body.replace(waybill, `${waybill}X`)
        expect(await send({ "x-ship-signature": shipbubble.sign(body) }, tampered)).toBe(401)

        expect((await order(orderId)).fulfilment.state).toBe("label_booked")
      })

      it("about a shipment that isn't ours are acknowledged and ignored", async () => {
        const { status: answered } = await shipbubbleSays("SB-NOTOURS", "confirmed")

        expect(answered).toBe(200)
      })
    })

    describe("a shipment Shipbubble cancels", () => {
      it("puts the order back to packed, with its fulfilment cancelled, for staff to rebook", async () => {
        const { orderId, waybill } = await bookedOrder()

        await shipbubbleSays(waybill, "cancelled")

        expect((await order(orderId)).fulfilment).toMatchObject({ state: "packed", shipment: { waybill, cancelled: true } })
        expect(await fulfilments(orderId)).toMatchObject([{ canceled: true }])
        // Shipbubble cancelled it already: it isn't asked to again.
        expect(shipbubble.cancellations()).toEqual([])
      })

      it("can be cancelled after the courier confirmed it", async () => {
        const { orderId, waybill } = await bookedOrder()
        await shipbubbleSays(waybill, "confirmed")

        await shipbubbleSays(waybill, "cancelled")

        expect((await order(orderId)).fulfilment.state).toBe("packed")
      })

      it("is rebooked with a new label, and its own webhooks no longer move the order", async () => {
        const { orderId, waybill } = await bookedOrder()
        await shipbubbleSays(waybill, "cancelled")

        const { data } = await bookLabel(orderId)

        const rebooked = data.fulfilment.shipment.waybill as string
        expect(rebooked).not.toBe(waybill)
        expect(data.fulfilment).toMatchObject({ state: "label_booked", shipment: { waybill: rebooked, cancelled: false } })
        expect(shipbubble.labelRequests()).toHaveLength(2)
        expect(await fulfilments(orderId)).toMatchObject([
          { canceled: true, labels: [{ tracking_number: waybill }] },
          { canceled: false, labels: [{ tracking_number: rebooked }] },
        ])

        // A late retry about the cancelled shipment changes nothing.
        expect((await shipbubbleSays(waybill, "cancelled")).status).toBe(200)
        expect((await shipbubbleSays(waybill, "confirmed")).status).toBe(200)
        expect((await order(orderId)).fulfilment.state).toBe("label_booked")

        await shipbubbleSays(rebooked, "confirmed")
        expect((await order(orderId)).fulfilment.state).toBe("courier_confirmed")
      })
    })
  },
})
