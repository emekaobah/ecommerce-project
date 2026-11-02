import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { MercurModules, SellerRole } from "@mercurjs/types"
import { endActivitiesOfClosedShops, startShopActivity } from "../../src/lib/vendor-live-activity"
import { LIVE_ACTIVITY_TOKEN_MODULE, type LiveActivityTokenModuleService } from "../../src/modules/live-activity-token"
import { resumeShop, setWeeklyHours } from "../../src/lib/shop-hours"
import { seedDemoWorld } from "../../src/scripts/seed"
import { SEED_PASSWORD } from "../../src/scripts/seed-data"
import { apnsToken, fakeApns } from "../helpers/apns"
import { vendorHeaders } from "../helpers/auth"
import { buyerCheckout, eventually, GADGETS, GROCERY, type Shop } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakeExpoPush, pushToken } from "../helpers/expo-push"
import { fakePaystack } from "../helpers/paystack"
import { fakeShipbubble } from "../helpers/shipbubble"
import { closedBetween, keepShopsOpen } from "../helpers/shop-hours"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
const paystack = fakePaystack(61000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(62000 + (process.pid % 1000))
const expo = fakeExpoPush(63000 + (process.pid % 1000))
const apns = fakeApns(64000 + (process.pid % 500), 64500 + (process.pid % 500))
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl
process.env.EXPO_ACCESS_TOKEN = expo.accessToken
process.env.EXPO_PUSH_API_URL = expo.apiUrl
Object.assign(process.env, apns.env)

const KEY_HEADER = "x-live-activity-key"
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })
    type Headers = { headers: Record<string, string> }
    const status = (request: Promise<unknown>) =>
      request.then(
        () => 200,
        (e: any) => e.response?.status as number
      )
    const staff = async (shop: Shop) => vendorHeaders(api, shop.staff.email, SEED_PASSWORD, await buyer.sellerId(shop))
    const withKey = (as: Headers, key: string): Headers => ({ headers: { ...as.headers, [KEY_HEADER]: key } })

    /** A member's phone signs in: it is given its key. */
    const registerPhone = async (as: Headers, environment = "sandbox") => {
      const { data } = await api.post("/vendor/live-activity-devices", { environment }, as)
      return data.device.key as string
    }
    /** What a launch with no session reports, with only the phone's key. */
    const reportPushToStart = (key: string, token = apnsToken(), environment = "sandbox") =>
      api.post("/vendor/live-activity-tokens", { kind: "push_to_start", token, environment }, { headers: { [KEY_HEADER]: key } }).then(() => token)
    /** What the phone reports of an activity: its token, and the shop its url names (ADR 0018). */
    const reportActivity = (key: string, sellerId: string, token = apnsToken(), id = `activity-${token}`) =>
      api
        .post("/vendor/live-activity-tokens", { kind: "activity", activity_id: id, token, seller_id: sellerId, environment: "sandbox" }, { headers: { [KEY_HEADER]: key } })
        .then(() => token)
    const endsOf = (token: string) => apns.sentTo(token).filter((p) => p.aps.event === "end")
    const lockScreen = (as: Headers, key: string) =>
      api.get("/vendor/live-activity-devices/current/shop", withKey(as, key)).then((r) => r.data.on as boolean)
    const setLockScreen = (as: Headers, key: string, on: boolean) => api.post("/vendor/live-activity-devices/current/shop", { on }, withKey(as, key))
    /** A phone that can be started by Apple, with the switch on for the shop `as` acts for. */
    const optedIn = async (as: Headers) => {
      const key = await registerPhone(as)
      const pushToStart = await reportPushToStart(key)
      await setLockScreen(as, key, true)
      return { key, pushToStart }
    }
    /** The grocery owner, added to the gadgets shop too: acting for either. */
    const memberOfBoth = async () => {
      const grocery = await buyer.owner(GROCERY)
      const gadgetsId = await buyer.sellerId(GADGETS)
      const { data: members } = await buyer.query().graph({ entity: "member", fields: ["id"], filters: { email: GROCERY.owner.email } })
      const memberId = members[0].id
      const sellers = getContainer().resolve<any>(MercurModules.SELLER)
      const [held] = await sellers.listSellerMembers({ seller_id: gadgetsId, member_id: memberId })
      if (!held) await sellers.createSellerMembers({ seller_id: gadgetsId, member_id: memberId, role_id: SellerRole.SELLER_ADMINISTRATION, is_owner: false })
      return { grocery, gadgets: { headers: { ...grocery.headers, "x-seller-id": gadgetsId } } }
    }
    const paidOrders = async () => {
      const { cartId } = await buyer.paidCheckout()
      return { grocery: await buyer.shopOrderId(GROCERY, cartId), gadgets: await buyer.shopOrderId(GADGETS, cartId) }
    }
    const startsOn = (token: string, count = 1) => eventually(async () => apns.sentTo(token), (sent) => sent.length >= count)
    /** Waits for the order's other pushes, so what wasn't sent to Apple by now won't be. */
    const newOrderPushTo = (device: string) => eventually(async () => expo.sentTo(device), (sent) => sent.length >= 1)
    const propsOf = (push: { aps: Record<string, any> }) => JSON.parse(push.aps["content-state"].props)

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start(), expo.start(), apns.start()])
      await seedDemoWorld({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop(), expo.stop(), apns.stop()]))
    beforeEach(async () => {
      expo.reset()
      apns.reset()
      await buyer.load()
      await keepShopsOpen(getContainer(), [GADGETS, GROCERY])
      // Each test starts with no phones, and its shops taking orders.
      const store = getContainer().resolve<LiveActivityTokenModuleService>(LIVE_ACTIVITY_TOKEN_MODULE)
      await store.deleteLiveActivityDevices((await store.listLiveActivityDevices({})).map(({ id }) => id))
      await Promise.all([GROCERY, GADGETS].map(async (shop) => resumeShop(getContainer(), await buyer.sellerId(shop))))
    })

    describe("the phone's registration", () => {
      it("gives a signed-in member's phone a key, and takes its tokens with only that key", async () => {
        const key = await registerPhone(await staff(GROCERY))
        expect(await status(reportPushToStart(key))).toBe(200)
      })

      it("refuses a token without a key the server knows", async () => {
        const body = { kind: "push_to_start", token: apnsToken(), environment: "sandbox" }
        expect(await status(api.post("/vendor/live-activity-tokens", body))).toBe(401)
        expect(await status(api.post("/vendor/live-activity-tokens", body, { headers: { [KEY_HEADER]: "not-a-key" } }))).toBe(401)
      })

      it("won't issue a key without a member's session", async () => {
        expect(await status(api.post("/vendor/live-activity-devices", { environment: "sandbox" }))).toBe(401)
      })

      it("is off until turned on, per shop and per phone, for any member", async () => {
        const member = await staff(GROCERY)
        const phone = await registerPhone(member)
        const otherPhone = await registerPhone(member)
        expect(await lockScreen(member, phone)).toBe(false)

        await setLockScreen(member, phone, true)

        expect(await lockScreen(member, phone)).toBe(true)
        expect(await lockScreen(member, otherPhone)).toBe(false)

        await setLockScreen(member, phone, false)
        expect(await lockScreen(member, phone)).toBe(false)
      })

      it("is chosen for each shop on a phone acting for several", async () => {
        const owner = await memberOfBoth()
        const key = await registerPhone(owner.grocery)
        await setLockScreen(owner.grocery, key, true)
        expect(await lockScreen(owner.grocery, key)).toBe(true)
        expect(await lockScreen(owner.gadgets, key)).toBe(false)
      })

      it("won't change it for a shop the member isn't in", async () => {
        const owner = await buyer.owner(GROCERY)
        const key = await registerPhone(owner)
        const notTheirs = { headers: { ...owner.headers, "x-seller-id": await buyer.sellerId(GADGETS) } }
        expect(await status(setLockScreen(notTheirs, key, true))).toBe(400)
      })

      it("won't change a phone that isn't the member's own", async () => {
        const key = await registerPhone(await staff(GROCERY))
        const someoneElse = await buyer.owner(GADGETS)
        expect(await status(setLockScreen(someoneElse, key, true))).toBe(404)
        expect(await lockScreen(someoneElse, key)).toBe(false)
      })

      it("forgets the phone and its tokens at sign-out", async () => {
        const member = await staff(GROCERY)
        const { key, pushToStart } = await optedIn(member)
        await api.delete("/vendor/live-activity-devices/current", withKey(member, key))

        expect(await status(reportPushToStart(key))).toBe(401)
        const device = pushToken()
        await api.post("/vendor/push-tokens", { token: device }, member)
        await paidOrders()
        await newOrderPushTo(device)
        expect(apns.sentTo(pushToStart)).toEqual([])
      })
    })

    describe("the day's first new order", () => {
      it("starts the shop's activity on phones that turned it on, showing the stage counts then", async () => {
        const groceryId = await buyer.sellerId(GROCERY)
        const member = await staff(GROCERY)
        const { pushToStart } = await optedIn(member)

        const { grocery } = await paidOrders()

        const [start, ...more] = await startsOn(pushToStart)
        expect(more).toEqual([])
        expect(start).toMatchObject({
          environment: "sandbox",
          pushType: "liveactivity",
          topic: "com.example.oja.vendor.push-type.liveactivity",
          priority: "10",
        })
        expect(start.aps).toMatchObject({ event: "start", "attributes-type": "LiveActivityAttributes", "input-push-token": 1 })
        expect(start.aps.attributes.url).toBe(`ojavendor://shop-orders/${groceryId}`)
        // Its own alert, silent: the new order's alarm keeps its sound.
        expect(start.aps.alert).toEqual({ title: GROCERY.name, body: "Today's orders are on your Lock Screen." })

        expect(start.aps["content-state"].name).toBe("ShopOrdersActivity")
        const { counts, deadline, urgent, shop } = propsOf(start)
        const { data } = await api.get("/vendor/order-stages", member)
        expect(counts).toEqual(data.counts)
        expect(counts.new).toBeGreaterThanOrEqual(1)
        expect(shop).toBe(GROCERY.name)
        expect(urgent).toBe(false)
        // No later than this order's: the shop may have others waiting from earlier tests.
        const { data: placed } = await buyer.query().graph({ entity: "order", fields: ["created_at"], filters: { id: grocery } })
        expect(Date.parse(deadline)).toBeLessThanOrEqual(Date.parse(placed[0].created_at as string) + DAY + 1000)
      })

      it("doesn't start on phones that didn't turn it on, or for another shop", async () => {
        const member = await buyer.owner(GROCERY)
        const off = await registerPhone(member)
        const offToken = await reportPushToStart(off)
        const device = pushToken()
        await api.post("/vendor/push-tokens", { token: device }, member)
        const gadgetsPhone = await optedIn(await buyer.owner(GADGETS))

        await paidOrders()
        await startsOn(gadgetsPhone.pushToStart)
        await newOrderPushTo(device)

        expect(apns.sentTo(offToken)).toEqual([])
        expect(apns.pushes().map((p) => p.token)).toEqual([gadgetsPhone.pushToStart])
        expect(propsOf(apns.sentTo(gadgetsPhone.pushToStart)[0]).shop).toBe(GADGETS.name)
      })

      it("doesn't start another for later orders that day", async () => {
        const { pushToStart } = await optedIn(await staff(GROCERY))
        const device = pushToken()
        await api.post("/vendor/push-tokens", { token: device }, await staff(GROCERY))

        await paidOrders()
        await startsOn(pushToStart)
        await paidOrders()
        await eventually(async () => expo.sentTo(device), (sent) => sent.length >= 2)

        expect(apns.sentTo(pushToStart)).toHaveLength(1)
      })

      it("starts afresh on the next day's first order", async () => {
        const member = await staff(GROCERY)
        const { key, pushToStart } = await optedIn(member)
        const { grocery } = await paidOrders()
        await startsOn(pushToStart)
        const yesterdays = await reportActivity(key, await buyer.sellerId(GROCERY))

        await startShopActivity(getContainer(), grocery, new Date(Date.now() + DAY))

        expect(apns.sentTo(pushToStart).map((p) => p.aps.event)).toEqual(["start", "start"])
        expect(apns.sentTo(yesterdays).map((p) => p.aps.event)).toEqual(["end"])
      })

      it("leaves the new-order push and alarm as they are, on every member's device", async () => {
        const owner = await buyer.owner(GROCERY)
        const { pushToStart } = await optedIn(owner)
        const ownerDevice = pushToken()
        await api.post("/vendor/push-tokens", { token: ownerDevice }, owner)
        const staffDevice = pushToken()
        await api.post("/vendor/push-tokens", { token: staffDevice }, await staff(GROCERY))

        await paidOrders()
        await startsOn(pushToStart)

        for (const device of [ownerDevice, staffDevice]) {
          const [push] = await newOrderPushTo(device)
          expect(push).toMatchObject({ sound: "oja_alarm.wav", channelId: "new-orders", interruptionLevel: "time-sensitive" })
        }
      })

      it("doesn't start while the shop is closed: its activity only runs in open hours", async () => {
        const groceryId = await buyer.sellerId(GROCERY)
        const member = await staff(GROCERY)
        const { pushToStart } = await optedIn(member)
        const device = pushToken()
        await api.post("/vendor/push-tokens", { token: device }, member)
        const now = Date.now() - (Date.now() % 60000)
        await setWeeklyHours(getContainer(), groceryId, closedBetween(now - 60000, now + 2 * HOUR, "Africa/Lagos"))

        await paidOrders()
        await newOrderPushTo(device)

        expect(apns.sentTo(pushToStart)).toEqual([])
      })

      it("doesn't reach a phone that has changed hands to someone outside the shop", async () => {
        const member = await staff(GROCERY)
        const { key, pushToStart } = await optedIn(member)
        await api.post("/vendor/live-activity-devices", { environment: "sandbox" }, withKey(await buyer.owner(GADGETS), key))
        const device = pushToken()
        await api.post("/vendor/push-tokens", { token: device }, await buyer.owner(GROCERY))

        await paidOrders()
        await newOrderPushTo(device)

        expect(apns.sentTo(pushToStart)).toEqual([])
      })

      it("keeps sandbox and production tokens apart", async () => {
        const member = await staff(GROCERY)
        const key = await registerPhone(member, "production")
        const token = await reportPushToStart(key, undefined, "production")
        await setLockScreen(member, key, true)
        await paidOrders()
        const [start] = await startsOn(token)
        expect(start.environment).toBe("production")
      })
    })

    describe("the end of the activity", () => {
      /** A running activity on a phone, with the update token the phone reported for it. */
      const running = async () => {
        const member = await buyer.owner(GROCERY)
        const { key, pushToStart } = await optedIn(member)
        await paidOrders()
        await startsOn(pushToStart)
        return { member, key, pushToStart, update: await reportActivity(key, await buyer.sellerId(GROCERY)) }
      }

      it("ends when the shop is paused", async () => {
        const { member, update } = await running()
        await api.post("/vendor/shop-hours/pause", {}, member)

        const [end, ...more] = await eventually(async () => apns.sentTo(update), (sent) => sent.length >= 1)
        expect(more).toEqual([])
        expect(end.priority).toBe("10")
        expect(end.aps.event).toBe("end")
        expect(end.aps["dismissal-date"]).toEqual(expect.any(Number))
        expect(propsOf(end).shop).toBe(GROCERY.name)
      })

      it("ends when the shop closes, and only then", async () => {
        const { update } = await running()
        const groceryId = await buyer.sellerId(GROCERY)
        const now = Date.now() - (Date.now() % 60000)

        await endActivitiesOfClosedShops(getContainer(), new Date(now + 5 * 60000))
        expect(apns.sentTo(update)).toEqual([])

        await setWeeklyHours(getContainer(), groceryId, closedBetween(now + HOUR, now + 3 * HOUR, "Africa/Lagos"))
        await endActivitiesOfClosedShops(getContainer(), new Date(now + 59 * 60000))
        expect(apns.sentTo(update)).toEqual([])

        await endActivitiesOfClosedShops(getContainer(), new Date(now + 61 * 60000))
        expect(apns.sentTo(update).map((p) => p.aps.event)).toEqual(["end"])

        await endActivitiesOfClosedShops(getContainer(), new Date(now + 62 * 60000))
        expect(apns.sentTo(update)).toHaveLength(1)
      })

      it("sends nothing for an activity the phone hasn't reported a token for, and starts again after", async () => {
        const member = await buyer.owner(GROCERY)
        const { pushToStart } = await optedIn(member)
        await paidOrders()
        await startsOn(pushToStart)

        await api.post("/vendor/shop-hours/pause", {}, member)
        await api.post("/vendor/shop-hours/resume", {}, member)
        await paidOrders()

        await startsOn(pushToStart, 2)
        expect(apns.pushes().filter((p) => p.aps.event === "end")).toEqual([])
      })

      it("only ends the shop that closed, on a phone running two shops' activities", async () => {
        const owner = await memberOfBoth()
        const { key, pushToStart } = await optedIn(owner.grocery)
        await paidOrders()
        await startsOn(pushToStart)
        const groceryUpdate = await reportActivity(key, await buyer.sellerId(GROCERY))
        await setLockScreen(owner.gadgets, key, true)
        await paidOrders()
        await startsOn(pushToStart, 2)
        const gadgetsUpdate = await reportActivity(key, await buyer.sellerId(GADGETS))
        expect(propsOf(apns.sentTo(pushToStart)[1]).shop).toBe(GADGETS.name)

        await api.post("/vendor/shop-hours/pause", {}, owner.gadgets)

        await eventually(async () => apns.sentTo(gadgetsUpdate), (sent) => sent.length >= 1)
        // The second order's alert reached it; the other shop's pause didn't.
        expect(apns.sentTo(groceryUpdate).map((p) => p.aps.event)).toEqual(["update"])
      })

      it("knows whose token it is when two activities on the phone are waiting for one, in whichever order they arrive", async () => {
        const owner = await memberOfBoth()
        const { key, pushToStart } = await optedIn(owner.grocery)
        await setLockScreen(owner.gadgets, key, true)
        await paidOrders()
        await startsOn(pushToStart, 2)
        const gadgetsUpdate = await reportActivity(key, await buyer.sellerId(GADGETS))
        const groceryUpdate = await reportActivity(key, await buyer.sellerId(GROCERY))

        await api.post("/vendor/shop-hours/pause", {}, owner.gadgets)

        const [ended] = await eventually(async () => endsOf(gadgetsUpdate), (sent) => sent.length >= 1)
        expect(propsOf(ended).shop).toBe(GADGETS.name)
        expect(endsOf(groceryUpdate)).toEqual([])
      })

      it("won't follow a token for a shop the member isn't in", async () => {
        const member = await buyer.owner(GROCERY)
        const { key, pushToStart } = await optedIn(member)
        await paidOrders()
        await startsOn(pushToStart)
        const notTheirs = await reportActivity(key, await buyer.sellerId(GADGETS))
        const update = await reportActivity(key, await buyer.sellerId(GROCERY))

        await api.post("/vendor/shop-hours/pause", {}, member)

        await eventually(async () => endsOf(update), (sent) => sent.length >= 1)
        expect(apns.sentTo(notTheirs)).toEqual([])
      })

      it("ends straight away an activity whose token arrives after the shop paused", async () => {
        const member = await buyer.owner(GROCERY)
        const { key, pushToStart } = await optedIn(member)
        await paidOrders()
        await startsOn(pushToStart)
        await api.post("/vendor/shop-hours/pause", {}, member)

        const late = await reportActivity(key, await buyer.sellerId(GROCERY))

        const [ended] = await eventually(async () => endsOf(late), (sent) => sent.length >= 1)
        expect(ended.aps.event).toBe("end")
      })

      it("ends straight away an activity whose token arrives after the shop closed", async () => {
        const member = await buyer.owner(GROCERY)
        const { key, pushToStart } = await optedIn(member)
        await paidOrders()
        await startsOn(pushToStart)
        const now = Date.now() - (Date.now() % 60000)
        await setWeeklyHours(getContainer(), await buyer.sellerId(GROCERY), closedBetween(now - 60000, now + 2 * HOUR, "Africa/Lagos"))
        await endActivitiesOfClosedShops(getContainer())

        const late = await reportActivity(key, await buyer.sellerId(GROCERY))

        await eventually(async () => endsOf(late), (sent) => sent.length >= 1)
      })

      it("leaves one activity for the shop after a pause and resume its token waited through", async () => {
        const member = await buyer.owner(GROCERY)
        const sellerId = await buyer.sellerId(GROCERY)
        const { key, pushToStart } = await optedIn(member)
        await paidOrders()
        await startsOn(pushToStart)
        await api.post("/vendor/shop-hours/pause", {}, member)
        await api.post("/vendor/shop-hours/resume", {}, member)
        await startsOn(pushToStart, 2)

        const first = await reportActivity(key, sellerId)
        const second = await reportActivity(key, sellerId)

        // One of the two is followed; the other can't be told from it, and goes.
        await eventually(async () => endsOf(second), (sent) => sent.length >= 1)
        expect(endsOf(first)).toEqual([])
        await api.post("/vendor/shop-hours/pause", {}, member)
        await eventually(async () => endsOf(first), (sent) => sent.length >= 1)
        expect(endsOf(second)).toHaveLength(1)
      })

      const rowsWith = (token: string) => getContainer().resolve<LiveActivityTokenModuleService>(LIVE_ACTIVITY_TOKEN_MODULE).listLiveActivities({ token })

      it.each([["410", "unregister"], ["BadDeviceToken", "rejectAsBad"]] as const)("forgets a token an update hears %s for", async (_, how) => {
        const { update } = await running()
        apns[how](update)

        await paidOrders()

        await eventually(() => rowsWith(update), (held: unknown[]) => held.length === 0)
      })

      it.each([["410", "unregister"], ["BadDeviceToken", "rejectAsBad"]] as const)("forgets a token an ending hears %s for", async (_, how) => {
        const { member, update } = await running()
        apns[how](update)

        await api.post("/vendor/shop-hours/pause", {}, member)

        await eventually(() => rowsWith(update), (held: unknown[]) => held.length === 0)
      })

      it("stops trying an ending once iOS has let the activity go", async () => {
        const { member, update } = await running()
        apns.fail(update)
        await api.post("/vendor/shop-hours/pause", {}, member)
        await endActivitiesOfClosedShops(getContainer())
        const later = new Date(Date.now() + 13 * HOUR)

        await endActivitiesOfClosedShops(getContainer(), later)
        const tries = apns.attemptsTo(update)
        await endActivitiesOfClosedShops(getContainer(), later)

        expect(apns.attemptsTo(update)).toBe(tries)
      })

      it("stops trying a rejected update token: the activity is over", async () => {
        const { member, update, pushToStart } = await running()
        apns.unregister(update)
        await api.post("/vendor/shop-hours/pause", {}, member)
        await api.post("/vendor/shop-hours/resume", {}, member)
        await paidOrders()
        await startsOn(pushToStart, 2)
        expect(apns.sentTo(update)).toEqual([])
      })
    })
  },
})
