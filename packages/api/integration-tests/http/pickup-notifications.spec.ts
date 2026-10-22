import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { collectByLabel, formatMoney, openingHoursLines } from "@oja/domain"
import { SellerRole } from "@mercurjs/types"
import { tellReadyForPickup } from "../../src/lib/buyer-notifications"
import { expirePickupHolds } from "../../src/lib/pickup-hold-expiry"
import { remindPickupHolds } from "../../src/lib/pickup-reminders"
import { setWeeklyHours } from "../../src/lib/shop-hours"
import seedDemoData from "../../src/scripts/seed"
import { SEED_PASSWORD, SEED_PERISHABLE_CATEGORIES, SEED_PRODUCTS } from "../../src/scripts/seed-data"
import { refundOrderShareWorkflow } from "../../src/workflows/order-fulfilment/workflows/refund-order-share"
import { vendorHeaders } from "../helpers/auth"
import { ADDRESS, buyerCheckout, eventually, GROCERY, RETURN_URL, RICE, type Shop } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakeExpoPush, pushToken, type PushMessage } from "../helpers/expo-push"
import { fakePaystack } from "../helpers/paystack"
import { fakeResend, type SentEmail } from "../helpers/resend"
import { fakeShipbubble } from "../helpers/shipbubble"
import { ALWAYS_OPEN } from "../helpers/shop-hours"

jest.setTimeout(5 * 60 * 1000)

// The pickup notifications (#33): the buyer is emailed as well as pushed when their order is
// Ready for pickup, reminded half-way through its hold and on its last day, sent a receipt once
// they collect it, and told what was refunded once it isn't collected; the shop's owners and
// managers are pushed about an order not collected.

const clerk = fakeClerk()
// A port per test process, so each fake can be named in the config before it is listening.
const paystack = fakePaystack(21000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(22000 + (process.pid % 1000))
const expo = fakeExpoPush(23000 + (process.pid % 1000))
const resend = fakeResend(24000 + (process.pid % 1000))
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
const TOMATOES = SEED_PRODUCTS.find((p) => p.category === SEED_PERISHABLE_CATEGORIES[0])!
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const money = (amount: number) => formatMoney(amount, "ngn")

const lagosDate = (instant: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date(instant))
/** An hour into the `days`th day after the day of `instant`, in Lagos. */
const intoDayAfter = (instant: string, days: number) =>
  new Date(Date.parse(`${lagosDate(Date.parse(instant))}T01:00:00+01:00`) + days * DAY)

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })
    const { ada, offerId, owner, sellerId } = buyer

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start(), expo.start(), resend.start()])
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop(), expo.stop(), resend.stop()]))
    beforeEach(async () => {
      expo.reset()
      resend.reset()
      await buyer.load()
      // Open round the clock, so the hold's days are calendar days whenever the test runs.
      await setWeeklyHours(getContainer(), await sellerId(GROCERY), ALWAYS_OPEN)
      await api.post("/vendor/collection-point", { follows_pickup_address: true, instructions: "Ask at the till." }, await owner(GROCERY))
    })

    const staff = async (shop: Shop) => vendorHeaders(api, shop.staff.email, SEED_PASSWORD, await sellerId(shop))
    const post = async (path: string, body = {}) => api.post(`/vendor/orders/${path}`, body, await owner(GROCERY))
    const vendorOrder = async (orderId: string) => (await api.get(`/vendor/orders/${orderId}`, await owner(GROCERY))).data.order
    const adasOrder = async (groupId: string, orderId: string) => {
      const { data } = await api.get(`/store/order-history/${groupId}`, ada())
      return data.order_group.orders.find((o: any) => o.id === orderId)
    }

    /** Ada's device registers for pushes, as the buyer app does once she's signed in. */
    const registerAda = async () => {
      const token = pushToken()
      await api.post("/store/push-tokens", { token }, ada())
      return token
    }
    const registerMember = async (headers: unknown) => {
      const token = pushToken()
      await api.post("/vendor/push-tokens", { token }, headers)
      return token
    }
    /** Waits long enough for whatever would have been sent, then says what arrived. */
    const settled = async () => new Promise((resolve) => setTimeout(resolve, 1500))
    const matching = <T extends { title?: string; subject?: string }>(sent: T[], pattern: RegExp) =>
      sent.filter((m) => pattern.test(m.title ?? m.subject ?? ""))
    /** The pushes to a device, and the emails to Ada, matching `pattern`, once one of each has arrived. */
    const toldAda = async (device: string, pattern: RegExp) => {
      const pushes = await eventually(async () => matching(expo.sentTo(device), pattern), (p) => p.length > 0)
      const emails = await eventually(async () => matching(resend.sentTo(ADA), pattern), (e) => e.length > 0)
      return { pushes, emails }
    }

    /** Ada's order of two bags of rice from the grocery, and any `fresh` tomatoes, to collect in store, packed and Ready. */
    const readyOrder = async ({ fresh = 0 } = {}) => {
      const { data } = await api.post("/store/carts", { region_id: buyer.regionId() }, ada())
      const cartId = data.cart.id as string
      await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await offerId(GROCERY, RICE.title), quantity: 2 }, ada())
      if (fresh) await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await offerId(GROCERY, TOMATOES.title), quantity: fresh }, ada())
      await api.post(`/store/carts/${cartId}/checkout`, { shipping_address: ADDRESS, pickup: [await sellerId(GROCERY)] }, ada())
      const { data: started } = await api.post(`/store/carts/${cartId}/checkout/payment`, { return_url: RETURN_URL }, ada())
      const reference = started.payment.reference as string
      paystack.pay(reference)
      await buyer.postWebhook(paystack.chargeSuccess(reference))
      const groupId = await buyer.orderGroupOf(cartId)
      await buyer.capturedWithin(cartId)
      const orderId = await buyer.shopOrderId(GROCERY, cartId)
      await eventually(() => vendorOrder(orderId), (o) => o.fulfilment?.state === "new")
      await post(`${orderId}/accept`)
      const { pick_list } = (await api.get(`/vendor/orders/${orderId}/pick-list`, await owner(GROCERY))).data
      for (const line of pick_list.lines) await post(`${orderId}/pick-list/${line.id}`, { picked: line.quantity })
      await post(`${orderId}/pack`)
      const order = await vendorOrder(orderId)
      const readyAt = order.fulfilment.timeline.find((s: any) => s.label === "Ready for pickup").at as string
      return { orderId, groupId, reference, readyAt, display_id: order.display_id as number }
    }
    const collect = async (groupId: string, orderId: string) => {
      const { code } = (await adasOrder(groupId, orderId)).pickup
      return post(`${orderId}/collect`, { code, collected_by: "Tunde Bakare" })
    }

    describe("once the order is ready for pickup", () => {
      it("emails the buyer the code, where to collect, the shop's hours and when to collect by, once", async () => {
        const device = await registerAda()
        const { orderId, groupId, display_id } = await readyOrder()

        const { pushes, emails } = await toldAda(device, /ready for pickup/i)

        const { pickup, fulfilment } = await adasOrder(groupId, orderId)
        const [email] = emails as SentEmail[]
        expect(email.subject).toBe(`Your Oja order #${display_id} from ${GROCERY.name} is ready for pickup`)
        for (const text of [
          pickup.code,
          GROCERY.pickup.address_1,
          GROCERY.pickup.landmark,
          "Ask at the till.",
          ...openingHoursLines(ALWAYS_OPEN),
          collectByLabel(fulfilment.collect_by.at, new Date(), "Africa/Lagos"),
          RICE.title,
        ]) {
          expect(email.text).toContain(text)
        }
        // Asked again (a re-emitted event), the buyer isn't told twice.
        await tellReadyForPickup(getContainer(), orderId)
        await settled()
        expect(matching(resend.sentTo(ADA), /ready for pickup/i)).toHaveLength(1)
        expect(matching(expo.sentTo(device), /ready for pickup/i)).toHaveLength(pushes.length)
      })
    })

    describe("while it waits to be collected", () => {
      it("reminds the buyer by push and email half-way through the hold and on its last day, once each", async () => {
        const device = await registerAda()
        const { orderId, readyAt, display_id } = await readyOrder()
        const reminders = () => ({
          pushes: matching(expo.sentTo(device), /waiting for you|last day/i) as PushMessage[],
          emails: matching(resend.sentTo(ADA), /waiting for you|last day/i),
        })

        // Open every day: the 5 open days after Ready are the next 5 calendar days.
        await remindPickupHolds(getContainer(), intoDayAfter(readyAt, 2))
        await settled()
        expect(reminders()).toEqual({ pushes: [], emails: [] })

        await remindPickupHolds(getContainer(), intoDayAfter(readyAt, 3))
        await remindPickupHolds(getContainer(), intoDayAfter(readyAt, 4))
        const halfWay = await eventually(async () => reminders(), (r) => r.pushes.length > 0 && r.emails.length > 0)
        expect(halfWay.pushes).toEqual([
          expect.objectContaining({
            title: `Order #${display_id} is waiting for you`,
            data: expect.objectContaining({ order_id: orderId }),
          }),
        ])
        expect(halfWay.emails.map((e) => e.subject)).toEqual([`Reminder: your Oja order #${display_id} is waiting for you`])

        await remindPickupHolds(getContainer(), intoDayAfter(readyAt, 5))
        await remindPickupHolds(getContainer(), new Date(intoDayAfter(readyAt, 5).getTime() + HOUR))
        const lastDay = await eventually(async () => reminders(), (r) => r.pushes.length > 1 && r.emails.length > 1)
        expect(lastDay.pushes.map((p) => p.title)).toEqual([`Order #${display_id} is waiting for you`, `Last day to collect order #${display_id}`])
        expect(lastDay.pushes[1]!.body).toContain("Collect by 12am")
        expect(lastDay.emails.map((e) => e.subject)).toEqual([
          `Reminder: your Oja order #${display_id} is waiting for you`,
          `Last day to collect your Oja order #${display_id}`,
        ])
        await settled()
        expect(reminders().pushes).toHaveLength(2)
        expect(reminders().emails).toHaveLength(2)
      })

      it("doesn't remind the buyer of an order already collected", async () => {
        const device = await registerAda()
        const { orderId, groupId, readyAt } = await readyOrder()
        await collect(groupId, orderId)

        await remindPickupHolds(getContainer(), intoDayAfter(readyAt, 3))
        await remindPickupHolds(getContainer(), intoDayAfter(readyAt, 5))

        await settled()
        expect(matching(expo.sentTo(device), /waiting for you|last day/i)).toEqual([])
        expect(matching(resend.sentTo(ADA), /waiting for you|last day/i)).toEqual([])
      })
    })

    describe("once the buyer collects it", () => {
      it("emails the buyer their receipt with a push, once", async () => {
        const device = await registerAda()
        const { orderId, groupId, display_id } = await readyOrder()

        await collect(groupId, orderId)

        const { pushes, emails } = await toldAda(device, /collected|receipt/i)
        expect(pushes).toEqual([
          expect.objectContaining({
            title: `Order #${display_id} collected`,
            body: expect.stringContaining("receipt"),
            data: expect.objectContaining({ url: `/order/${groupId}`, order_id: orderId }),
          }),
        ])
        expect(emails).toHaveLength(1)
        expect(emails[0]!.subject).toBe(`Your Oja receipt: order #${display_id} from ${GROCERY.name}`)
        for (const text of ["Tunde Bakare", RICE.title, `Paid ${money(2 * RICE.price)}`]) expect(emails[0]!.text).toContain(text)
        expect(emails[0]!.text).not.toContain("Delivering to")
        await settled()
        expect(matching(expo.sentTo(device), /collected/i)).toHaveLength(1)
      })
    })

    describe("once nobody collects it", () => {
      /** The hold-expiry job, run long after the hold ended. */
      const longAfter = (readyAt: string) => expirePickupHolds(getContainer(), new Date(Date.parse(readyAt) + 30 * DAY))

      it("tells the buyer what was refunded and which fresh items weren't, once, in place of the refund's own push", async () => {
        const device = await registerAda()
        const { orderId, groupId, reference, readyAt, display_id } = await readyOrder({ fresh: 1 })

        await longAfter(readyAt)

        const { pushes, emails } = await toldAda(device, /wasn't collected/i)
        expect(pushes).toEqual([
          expect.objectContaining({
            title: `Order #${display_id} wasn't collected`,
            body: `${GROCERY.name} held it, but it wasn't collected in time. You'll be refunded ${money(2 * RICE.price)}. Fresh items aren't refunded: 1 × ${TOMATOES.title}.`,
            data: expect.objectContaining({ url: `/order/${groupId}`, order_id: orderId }),
          }),
        ])
        expect(emails.map((e) => e.subject)).toEqual([`Your Oja order #${display_id} from ${GROCERY.name} wasn't collected`])
        for (const text of [RICE.title, money(2 * RICE.price), TOMATOES.title]) expect(emails[0]!.text).toContain(text)

        // Paystack completes the refund: the buyer isn't told about it again.
        for (const refund of paystack.refundsOf(reference)) {
          paystack.settleRefund(refund.id, "processed")
          await buyer.postWebhook(paystack.refundEvent(refund.id))
        }
        await eventually(() => adasOrder(groupId, orderId), (o) => o.refund?.status === "processed")
        await longAfter(readyAt)
        await settled()
        expect(matching(expo.sentTo(device), /refund|wasn't collected/i)).toHaveLength(1)
        expect(matching(resend.sentTo(ADA), /wasn't collected/i)).toHaveLength(1)
      })

      it("still pushes a later refund of the order, such as Oja's team refunding the fresh items", async () => {
        const device = await registerAda()
        const { orderId, groupId, reference, readyAt, display_id } = await readyOrder({ fresh: 1 })
        await longAfter(readyAt)
        await toldAda(device, /wasn't collected/i)
        const settle = async () => {
          for (const refund of paystack.refundsOf(reference)) {
            paystack.settleRefund(refund.id, "processed")
            await buyer.postWebhook(paystack.refundEvent(refund.id))
          }
        }
        await settle()
        await eventually(() => adasOrder(groupId, orderId), (o) => o.refund?.status === "processed")

        await refundOrderShareWorkflow(getContainer()).run({
          input: { order_id: orderId, amount: TOMATOES.price, created_by: "user_operator", note: "Fresh items refunded" },
        })
        await settle()

        const pushes = await eventually(async () => matching(expo.sentTo(device), /refund/i), (p) => p.length > 0)
        expect(pushes).toEqual([
          expect.objectContaining({
            title: `Refund for order #${display_id} completed`,
            body: `The refund of ${money(TOMATOES.price)} from ${GROCERY.name} has completed.`,
          }),
        ])
        await settled()
        expect(matching(expo.sentTo(device), /refund/i)).toHaveLength(1)
      })

      it("pushes the shop's owners and managers, not its other staff", async () => {
        const ownerDevice = await registerMember(await owner(GROCERY))
        const staffDevice = await registerMember(await staff(GROCERY))
        const { orderId, readyAt, display_id } = await readyOrder()

        await longAfter(readyAt)

        const [push] = await eventually(async () => expo.sentTo(ownerDevice), (sent) => matching(sent, /collected/i).length > 0).then(
          (sent) => matching(sent, /collected/i)
        )
        expect(push).toMatchObject({
          title: `Order #${display_id} wasn't collected`,
          data: { url: `/orders/${orderId}`, order_id: orderId, seller_id: await sellerId(GROCERY) },
        })
        await settled()
        expect(matching(expo.sentTo(staffDevice), /collected/i)).toEqual([])
      })

      it("pushes a manager too: the shop's administration role, without owning it", async () => {
        const { data: me } = await api.get(`/vendor/sellers/${await sellerId(GROCERY)}/members/me`, await staff(GROCERY))
        const { updateMemberRoleWorkflow } = await import("@mercurjs/core/workflows")
        await updateMemberRoleWorkflow(getContainer()).run({
          input: { seller_member_id: me.seller_member.id, role_id: SellerRole.SELLER_ADMINISTRATION },
        })
        try {
          const managerDevice = await registerMember(await staff(GROCERY))
          const { readyAt, display_id } = await readyOrder()

          await longAfter(readyAt)

          const sent = await eventually(async () => expo.sentTo(managerDevice), (s) => matching(s, /collected/i).length > 0)
          expect(matching(sent, /collected/i).map((p) => p.title)).toEqual([`Order #${display_id} wasn't collected`])
        } finally {
          await updateMemberRoleWorkflow(getContainer()).run({
            input: { seller_member_id: me.seller_member.id, role_id: SellerRole.ORDER_MANAGEMENT },
          })
        }
      })
    })
  },
})
