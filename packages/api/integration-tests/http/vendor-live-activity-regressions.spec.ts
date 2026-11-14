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
const paystack = fakePaystack(31000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(32000 + (process.pid % 1000))
const expo = fakeExpoPush(33000 + (process.pid % 1000))
const apns = fakeApns(34000 + (process.pid % 500), 34500 + (process.pid % 500))
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

    it("starts today's activity even when yesterday evening's one couldn't be ended", async () => {
      const member = await staff(GROCERY)
      const { key, pushToStart } = await optedIn(member)
      const { grocery } = await paidOrders()
      await startsOn(pushToStart)
      const yesterdays = await reportActivity(key, await buyer.sellerId(GROCERY))

      // 01:00 tomorrow in Lagos (UTC+1), with the running activity started at 23:00 tonight: a new day, inside iOS's 12 hours.
      const lagosNow = Date.now() + HOUR
      const tomorrow1am = new Date(Math.ceil(lagosNow / DAY) * DAY - HOUR + HOUR)
      const store = getContainer().resolve<LiveActivityTokenModuleService>(LIVE_ACTIVITY_TOKEN_MODULE)
      const running = await store.listLiveActivities({ kind: "vendor_shop", ended_at: null })
      await store.updateLiveActivities(running.map(({ id }) => ({ id, started_at: new Date(tomorrow1am.getTime() - 2 * HOUR) })))
      apns.fail(yesterdays)

      await startShopActivity(getContainer(), grocery, tomorrow1am)

      expect(apns.sentTo(pushToStart).map((p) => p.aps.event)).toEqual(["start", "start"])
    })
  },
})
