import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import seedDemoData from "../../src/scripts/seed"
import { SEED_PASSWORD } from "../../src/scripts/seed-data"
import { remindAcceptDeadlines } from "../../src/lib/order-acceptance"
import { ORDER_PICKUP_SCHEDULED } from "../../src/lib/order-fulfilment"
import { checkPushReceipts } from "../../src/lib/push-receipts"
import { PUSH_TOKEN_MODULE, type PushTokenModuleService } from "../../src/modules/push-token"
import { vendorHeaders } from "../helpers/auth"
import { buyerCheckout, eventually, GADGETS, GROCERY, type Shop } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakeExpoPush, pushToken, type PushMessage } from "../helpers/expo-push"
import { fakePaystack } from "../helpers/paystack"
import { fakeShipbubble } from "../helpers/shipbubble"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so each fake can be named in the config before it is listening.
const paystack = fakePaystack(49000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(50000 + (process.pid % 1000))
const expo = fakeExpoPush(51000 + (process.pid % 1000))
// Set before the runner loads medusa-config.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl
process.env.EXPO_ACCESS_TOKEN = expo.accessToken
process.env.EXPO_PUSH_API_URL = expo.apiUrl

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

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
      expo.reset()
      await buyer.load()
    })

    const staff = async (shop: Shop) => vendorHeaders(api, shop.staff.email, SEED_PASSWORD, await buyer.sellerId(shop))
    /** A member's device registers for pushes, as the vendor app does once they're signed in to a shop. */
    const registerMember = async (headers: unknown, token = pushToken()) => {
      await api.post("/vendor/push-tokens", { token }, headers)
      return token
    }
    const removeMember = (headers: unknown, token: string) =>
      api.delete(`/vendor/push-tokens/${encodeURIComponent(token)}`, headers)
    /** The pushes a device has had, once at least `count` have arrived. */
    const pushesTo = (token: string, count = 1) => eventually(async () => expo.sentTo(token), (sent) => sent.length >= count)
    /** Waits long enough for a push that would have been sent, then says what arrived. */
    const settledPushesTo = async (token: string, after: () => Promise<unknown>) => {
      await after()
      await new Promise((resolve) => setTimeout(resolve, 1500))
      return expo.sentTo(token)
    }
    const paidOrders = async () => {
      const { cartId } = await buyer.paidCheckout()
      return { gadgets: await buyer.shopOrderId(GADGETS, cartId), grocery: await buyer.shopOrderId(GROCERY, cartId) }
    }
    const displayId = async (orderId: string) => {
      const { data } = await buyer.query().graph({ entity: "order", fields: ["display_id"], filters: { id: orderId } })
      return data[0].display_id as number
    }
    /** Whether the device is still registered for pushes, to anyone. */
    const registered = async (token: string) =>
      (await getContainer().resolve<PushTokenModuleService>(PUSH_TOKEN_MODULE).listPushTokens({ token })).length > 0
    const opens = (orderId: string, sellerId: string): Partial<PushMessage> => ({
      data: { url: `/orders/${orderId}`, order_id: orderId, seller_id: sellerId },
    })

    /** The grocery owner's device, about to be uninstalled, and a staff member's. */
    const ownerAndStaffDevices = async () => ({
      gone: await registerMember(await buyer.owner(GROCERY)),
      device: await registerMember(await staff(GROCERY)),
    })
    /** The next order's push reaches `device` and not the forgotten `gone`, which got only the first. */
    const expectOnlyReached = async (device: string, gone: string) => {
      await paidOrders()
      await pushesTo(device, 2)
      expect(await settledPushesTo(gone, async () => {})).toHaveLength(1)
    }

    describe("a new order", () => {
      it("pushes to every device of the shop's members, and to no other shop", async () => {
        const ownerDevice = await registerMember(await buyer.owner(GROCERY))
        const staffDevice = await registerMember(await staff(GROCERY))
        const gadgetsDevice = await registerMember(await buyer.owner(GADGETS))

        const { grocery, gadgets } = await paidOrders()

        const groceryId = await buyer.sellerId(GROCERY)
        for (const device of [ownerDevice, staffDevice]) {
          const [push] = await pushesTo(device)
          expect(push).toMatchObject({
            title: `New order #${await displayId(grocery)}`,
            body: "2 items. Accept or reject it in the app.",
            sound: "default",
            ...opens(grocery, groceryId),
          })
        }
        const [gadgetsPush] = await pushesTo(gadgetsDevice)
        expect(gadgetsPush).toMatchObject(opens(gadgets, await buyer.sellerId(GADGETS)))
        expect(expo.sentTo(ownerDevice)).toHaveLength(1)
      })

      it("forgets a device Expo says is no longer installed, and still reaches the others", async () => {
        const { gone, device } = await ownerAndStaffDevices()
        expo.uninstall(gone)

        const { grocery } = await paidOrders()

        const [push] = await pushesTo(device)
        expect(push).toMatchObject(opens(grocery, await buyer.sellerId(GROCERY)))
        await eventually(() => registered(gone), (still) => !still)
        expect(await registered(device)).toBe(true)

        await expectOnlyReached(device, gone)
      })
    })

    describe("checking push receipts", () => {
      it("forgets a device whose receipt says it is no longer installed, and keeps the others", async () => {
        const { gone, device } = await ownerAndStaffDevices()
        expo.uninstallAfterSend(gone)
        await paidOrders()
        await pushesTo(gone)
        await pushesTo(device)

        // Before Expo has had time to deliver, the receipts aren't asked for.
        await checkPushReceipts(getContainer(), new Date(Date.now() + 5 * MINUTE))
        expect(await registered(gone)).toBe(true)

        await checkPushReceipts(getContainer(), new Date(Date.now() + 20 * MINUTE))
        expect(await registered(gone)).toBe(false)
        expect(await registered(device)).toBe(true)

        await expectOnlyReached(device, gone)
      })
    })

    describe("registering devices", () => {
      it("stops pushing to a member's device once it is removed at sign-out", async () => {
        const owner = await buyer.owner(GROCERY)
        const device = await registerMember(owner)

        expect((await removeMember(owner, device)).data).toEqual({ token: device, deleted: true })

        expect(await settledPushesTo(device, paidOrders)).toEqual([])
      })

      it("registers a device once, however often the app registers it", async () => {
        const owner = await buyer.owner(GROCERY)
        const device = await registerMember(owner)
        const { data } = await api.post("/vendor/push-tokens", { token: device }, owner)
        expect(data).toEqual({ push_token: { token: device } })

        await paidOrders()

        await pushesTo(device)
        expect(await settledPushesTo(device, async () => {})).toHaveLength(1)
      })

      it("moves a device to whoever signs in on it next", async () => {
        const device = await registerMember(await buyer.owner(GROCERY))
        await registerMember(await buyer.owner(GADGETS), device)

        const { gadgets } = await paidOrders()

        const pushes = await settledPushesTo(device, () => pushesTo(device))
        expect(pushes).toEqual([expect.objectContaining(opens(gadgets, await buyer.sellerId(GADGETS)))])
      })

      it("leaves a device alone when someone else asks to remove it", async () => {
        const device = await registerMember(await buyer.owner(GROCERY))

        await removeMember(await staff(GROCERY), device)

        await paidOrders()
        expect(await pushesTo(device)).toHaveLength(1)
      })

      it("registers and removes a buyer's device; a member's device a buyer signs in on is theirs", async () => {
        const device = await registerMember(await buyer.owner(GROCERY))

        const { data } = await api.post("/store/push-tokens", { token: device }, buyer.ada())
        expect(data).toEqual({ push_token: { token: device } })
        expect(await settledPushesTo(device, paidOrders)).toEqual([])

        const removed = await api.delete(`/store/push-tokens/${encodeURIComponent(device)}`, buyer.ada())
        expect(removed.data).toEqual({ token: device, deleted: true })
      })

      it("is for signed-in members and buyers, with an Expo push token", async () => {
        const owner = await buyer.owner(GROCERY)
        expect(await status(api.post("/vendor/push-tokens", { token: "not-a-push-token" }, owner))).toBe(400)
        expect(await status(api.post("/vendor/push-tokens", { token: pushToken() }))).toBe(401)
        expect(await status(api.post("/store/push-tokens", { token: pushToken() }, { headers: buyer.headers() }))).toBe(401)
        expect(await status(api.post("/store/push-tokens", { token: "" }, buyer.ada()))).toBe(400)
      })
    })

    describe("the accept deadline approaching", () => {
      it("reminds the shop once, two hours before an order it hasn't accepted is rejected", async () => {
        const groceryDevice = await registerMember(await buyer.owner(GROCERY))
        const gadgetsDevice = await registerMember(await buyer.owner(GADGETS))
        const { grocery, gadgets } = await paidOrders()
        await pushesTo(groceryDevice)
        await pushesTo(gadgetsDevice)
        await api.post(`/vendor/orders/${gadgets}/accept`, {}, await buyer.owner(GADGETS))
        const { data } = await buyer.query().graph({ entity: "order", fields: ["created_at"], filters: { id: grocery } })
        const placedAt = Date.parse(data[0].created_at)

        await remindAcceptDeadlines(getContainer(), new Date(placedAt + 21 * HOUR))
        expect(await settledPushesTo(groceryDevice, async () => {})).toHaveLength(1)

        await remindAcceptDeadlines(getContainer(), new Date(placedAt + 22 * HOUR + 5 * 60 * 1000))
        const [, reminder] = await pushesTo(groceryDevice, 2)
        expect(reminder).toMatchObject({
          title: `Order #${await displayId(grocery)} is waiting`,
          body: "1h 55m left to accept it, or it is rejected and refunded.",
          ...opens(grocery, await buyer.sellerId(GROCERY)),
        })

        await remindAcceptDeadlines(getContainer(), new Date(placedAt + 23 * HOUR))
        expect(await settledPushesTo(groceryDevice, async () => {})).toHaveLength(2)
        // The accepted order needs no reminder.
        expect(expo.sentTo(gadgetsDevice)).toHaveLength(1)
      })
    })

    describe("a courier pickup scheduled", () => {
      it("tells the shop to have the parcel ready", async () => {
        const device = await registerMember(await staff(GROCERY))
        const { grocery } = await paidOrders()
        await pushesTo(device)

        await getContainer()
          .resolve(Modules.EVENT_BUS)
          .emit({ name: ORDER_PICKUP_SCHEDULED, data: { id: grocery } })

        const [, push] = await pushesTo(device, 2)
        expect(push).toMatchObject({
          title: `Courier pickup booked for order #${await displayId(grocery)}`,
          body: "Have the parcel packed and ready at the counter.",
          ...opens(grocery, await buyer.sellerId(GROCERY)),
        })
      })
    })
  },
})
