import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { remindAcceptDeadlines } from "../../src/lib/order-acceptance"
import { fulfilmentService } from "../../src/lib/order-fulfilment"
import { resumeShop, setWeeklyHours } from "../../src/lib/shop-hours"
import { keepShopActivitiesCurrent } from "../../src/lib/vendor-live-activity"
import { LIVE_ACTIVITY_TOKEN_MODULE, type LiveActivityTokenModuleService } from "../../src/modules/live-activity-token"
import { seedDemoWorld } from "../../src/scripts/seed"
import { buyerCheckout, eventually, GADGETS, GROCERY } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakeExpoPush, pushToken } from "../helpers/expo-push"
import { fakePaystack } from "../helpers/paystack"
import { fakeShipbubble } from "../helpers/shipbubble"
import { ALWAYS_OPEN, closedBetween, keepShopsOpen } from "../helpers/shop-hours"

jest.setTimeout(5 * 60 * 1000)

// The shop's orders on an Android phone (#149): the data-only messages that reach Expo.

const clerk = fakeClerk()
const paystack = fakePaystack(44000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(45000 + (process.pid % 1000))
const expo = fakeExpoPush(46000 + (process.pid % 1000))
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl
process.env.EXPO_ACCESS_TOKEN = expo.accessToken
process.env.EXPO_PUSH_API_URL = expo.apiUrl

const KEY_HEADER = "x-live-activity-key"
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const LAGOS = "Africa/Lagos"

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })
    type Headers = { headers: Record<string, string> }
    const owner = () => buyer.owner(GROCERY)
    const withKey = (as: Headers, key: string): Headers => ({ headers: { ...as.headers, [KEY_HEADER]: key } })

    /** A phone that registered for pushes and for the shop's switch, as the vendor app does on Android. */
    const phone = async (as: Headers, { on = true, platform = "android" }: { on?: boolean; platform?: string } = {}) => {
      const device = pushToken()
      await api.post("/vendor/push-tokens", { token: device, platform }, as)
      const { data } = await api.post("/vendor/live-activity-devices", { environment: "production", push_token: device }, as)
      const key = data.device.key as string
      if (on) await api.post("/vendor/live-activity-devices/current/shop", { on: true }, withKey(as, key))
      return { device, key }
    }
    const placeOrder = async () => {
      const { cartId } = await buyer.paidCheckout()
      return buyer.shopOrderId(GROCERY, cartId)
    }
    const accept = async (orderId: string) => api.post(`/vendor/orders/${orderId}/accept`, {}, await owner())
    const groceryHours = async (weekly: typeof ALWAYS_OPEN) => setWeeklyHours(getContainer(), await buyer.sellerId(GROCERY), weekly)
    const tick = (at: number) => keepShopActivitiesCurrent(getContainer(), new Date(at))
    const tiles = async () => (await api.get("/vendor/order-stages", await owner())).data.counts

    const updates = (device: string) => expo.sentTo(device).filter((m) => m.data?.live_update) as any[]
    const newOrderPushes = (device: string) => expo.sentTo(device).filter((m) => m.title && !m.data?.live_update)
    const updateArrives = (device: string, count = 1) => eventually(async () => updates(device), (sent) => sent.length >= count)
    /** An Android phone with the shop showing, its first message already there. */
    const showing = async () => {
      const member = await owner()
      const { device, key } = await phone(member)
      const orderId = await placeOrder()
      await updateArrives(device)
      return { member, device, key, orderId }
    }

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start(), expo.start()])
      await seedDemoWorld({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop(), expo.stop()]))
    beforeEach(async () => {
      expo.reset()
      await buyer.load()
      await keepShopsOpen(getContainer(), [GADGETS, GROCERY])
      const store = getContainer().resolve<LiveActivityTokenModuleService>(LIVE_ACTIVITY_TOKEN_MODULE)
      await store.deleteLiveActivityDevices((await store.listLiveActivityDevices({})).map(({ id }) => id))
      await Promise.all([GROCERY, GADGETS].map(async (shop) => resumeShop(getContainer(), await buyer.sellerId(shop))))
      const fulfilments = fulfilmentService(getContainer())
      const waiting = await fulfilments.listOrderFulfilments({ state: "new" }, { select: ["id"], take: null })
      if (waiting.length) await fulfilments.updateOrderFulfilments(waiting.map(({ id }) => ({ id, state: "rejected" })))
    })

    describe("starting", () => {
      it("shows the shop on an opted-in Android phone with the day's first new order, in a data-only message", async () => {
        const { device } = await showing()
        const [message, ...more] = updates(device)
        const sellerId = await buyer.sellerId(GROCERY)

        expect(more).toEqual([])
        expect(message.title).toBeUndefined()
        expect(message.body).toBeUndefined()
        expect(message.ttl).toBeGreaterThan(0)
        expect(message.data).toMatchObject({
          live_update: "vendor_shop",
          action: "show",
          seller_id: sellerId,
          url: expect.stringContaining(`shop-orders/${sellerId}`),
          content: { counts: await tiles(), urgent: false, deadline: expect.any(String) },
        })
      })

      it("still sends the new-order push, and a phone that hasn't opted in gets only that", async () => {
        const member = await owner()
        const off = await phone(member, { on: false })
        const { device } = await showing()

        await eventually(async () => newOrderPushes(off.device), (sent) => sent.length >= 1)
        expect(updates(off.device)).toEqual([])
        await eventually(async () => newOrderPushes(device), (sent) => sent.length >= 1)
      })

      it("tells each phone only about the shop it opted in for", async () => {
        const gadgets = await phone(await buyer.owner(GADGETS))
        const grocery = await showing()
        await updateArrives(gadgets.device)

        expect(updates(grocery.device).map((m) => m.data.seller_id)).toEqual([await buyer.sellerId(GROCERY)])
        expect(updates(gadgets.device).map((m) => m.data.seller_id)).toEqual([await buyer.sellerId(GADGETS)])
      })

      it("sends no data-only messages to an iPhone, even with its Expo token known", async () => {
        const { device } = await phone(await owner(), { platform: "ios" })
        const here = await showing()

        expect(updates(here.device)).toHaveLength(1)
        expect(updates(device)).toEqual([])
      })

      it("is forgotten once Expo says the app is gone", async () => {
        const { device, orderId } = await showing()
        expo.uninstall(device)
        await accept(orderId)
        await tick(Date.now() + MINUTE)
        const tried = updates(device).length

        await placeOrder()
        await tick(Date.now() + 2 * MINUTE)

        expect(updates(device)).toHaveLength(tried)
      })
    })

    describe("staying current", () => {
      it("sends several changes as one update with the latest counts, matching the stage tiles", async () => {
        const { device } = await showing()
        const second = await placeOrder()
        await updateArrives(device, 2)
        const third = await placeOrder()
        await updateArrives(device, 3)
        expect(updates(device).at(-1).data.content.counts.new).toBeGreaterThanOrEqual(3)

        await accept(second)
        await accept(third)
        expect(updates(device)).toHaveLength(3)

        await tick(Date.now() + MINUTE)

        expect(updates(device)).toHaveLength(4)
        expect(updates(device).at(-1).data.action).toBe("show")
        expect(updates(device).at(-1).data.content.counts).toEqual(await tiles())

        await tick(Date.now() + 2 * MINUTE)
        expect(updates(device)).toHaveLength(4)
      })

      it("updates at once for a new order, once, even on the phone it started on", async () => {
        const { device } = await showing()
        expect(updates(device)).toHaveLength(1)
        expect(updates(device)[0].data.content.counts.new).toBe((await tiles()).new)

        await placeOrder()
        await updateArrives(device, 2)

        expect(updates(device)).toHaveLength(2)
        expect(updates(device)[1].data.content.counts).toEqual(await tiles())
      })

      it("carries an absolute deadline and sends nothing while it ticks, then turns urgent at once in the last two hours", async () => {
        const { device, orderId } = await showing()
        const [row] = await fulfilmentService(getContainer()).listOrderFulfilments({ order_id: orderId }, { select: ["placed_at"] })
        const placed = new Date(row.placed_at).getTime()
        const deadline = new Date(placed + 24 * HOUR).toISOString()
        expect(updates(device)[0].data.content.deadline).toBe(deadline)

        await tick(Date.now() + 5 * MINUTE)
        expect(updates(device)).toHaveLength(1)

        await remindAcceptDeadlines(getContainer(), new Date(placed + 22 * HOUR + MINUTE))

        const [, urgent] = await updateArrives(device, 2)
        expect(urgent.data.content).toMatchObject({ urgent: true, deadline })
        expect(urgent.title).toBeUndefined()
      })

      it("moves the deadline when open hours move it", async () => {
        const { device, orderId } = await showing()
        const [row] = await fulfilmentService(getContainer()).listOrderFulfilments({ order_id: orderId }, { select: ["placed_at"] })
        const now = Date.now() - (Date.now() % MINUTE)

        await groceryHours(closedBetween(now + HOUR, now + 3 * HOUR, LAGOS))
        await tick(now + 2 * MINUTE)

        const [, moved] = await updateArrives(device, 2)
        expect(moved.data.content.deadline).toBe(new Date(new Date(row.placed_at).getTime() + 26 * HOUR).toISOString())
      })
    })

    describe("ending", () => {
      it("removes it when the shop is paused", async () => {
        const { member, device } = await showing()

        await api.post("/vendor/shop-hours/pause", {}, member)

        const sent = await updateArrives(device, 2)
        expect(sent[1].data.action).toBe("remove")
        expect(sent[1].data.seller_id).toBe(await buyer.sellerId(GROCERY))
        expect(sent[1].title).toBeUndefined()
      })

      it("removes it when the shop closes, and shows it again with the deadline when the shop opens", async () => {
        const { device } = await showing()
        const now = Date.now() - (Date.now() % MINUTE)
        await groceryHours(closedBetween(now + HOUR, now + 3 * HOUR, LAGOS))

        await tick(now + HOUR + MINUTE)
        const ended = updates(device).at(-1)
        expect(ended.data.action).toBe("remove")

        await tick(now + 3 * HOUR + MINUTE)
        const reopened = updates(device).at(-1)
        expect(reopened.data.action).toBe("show")
        expect(reopened.data.content.deadline).toEqual(expect.any(String))
        expect(reopened.data.revision).toBeGreaterThan(ended.data.revision)
      })

      it("removes it within a minute of the switch going off, and sends nothing after", async () => {
        const { member, device, key } = await showing()

        await api.post("/vendor/live-activity-devices/current/shop", { on: false }, withKey(member, key))
        await tick(Date.now() + MINUTE)

        const sent = await updateArrives(device, 2)
        expect(sent[1].data.action).toBe("remove")

        await placeOrder()
        await tick(Date.now() + 2 * MINUTE)
        expect(updates(device)).toHaveLength(2)
      })
    })
  },
})
