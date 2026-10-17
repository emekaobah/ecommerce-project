import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { openingHoursLines, PERISHABLE_PICKUP_NOTE, PICKUP_HOLD_NOTICE } from "@oja/domain"
import { payOutDeliveredOrders } from "../../src/lib/pay-out-orders"
import { expirePickupHolds } from "../../src/lib/pickup-hold-expiry"
import { SHOP_HOURS_MODULE, type ShopHoursModuleService } from "../../src/modules/shop-hours"
import seedDemoData from "../../src/scripts/seed"
import { SEED_PASSWORD, SEED_PERISHABLE_CATEGORIES, SEED_PRODUCTS } from "../../src/scripts/seed-data"
import { vendorHeaders } from "../helpers/auth"
import {
  ADDRESS,
  buyerCheckout,
  eventually,
  GADGETS,
  GROCERY,
  LANTERN,
  RETURN_URL,
  RICE,
  type Shop,
} from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakeExpoPush, pushToken, type PushMessage } from "../helpers/expo-push"
import { fakePaystack } from "../helpers/paystack"
import { BEST_VALUE_FEE, COURIERS, fakeShipbubble } from "../helpers/shipbubble"
import { ALWAYS_OPEN } from "../helpers/shop-hours"
import { setWeeklyHours } from "../../src/lib/shop-hours"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so each fake can be named in the config before it is listening.
const paystack = fakePaystack(43000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(44000 + (process.pid % 1000))
const expo = fakeExpoPush(45000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers each provider only when its key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl
process.env.EXPO_ACCESS_TOKEN = expo.accessToken
process.env.EXPO_PUSH_API_URL = expo.apiUrl

const TOMATOES = SEED_PRODUCTS.find((p) => p.category === SEED_PERISHABLE_CATEGORIES[0])!

/** Ada's details when nothing of hers is delivered: a name and a phone, no address. */
const CONTACT = { first_name: "Ada", last_name: "Obi", phone: "+2348031234567" }

/** The grocery's own collection point: its pickup address, with a word for buyers. */
const AT_THE_SHOP = { follows_pickup_address: true, instructions: "Ask at the till for online orders.", phone: "+2348031234511" }
/** A separate collection point, pinned on the map like any address (ADR 0002). */
const KIOSK = {
  follows_pickup_address: false,
  address: {
    address_1: "3 Bode Thomas Street",
    city: "Surulere",
    province: "Lagos",
    country_code: "ng",
    metadata: { landmark: "The blue kiosk by the bus stop", latitude: 6.4892, longitude: 3.3561 },
  },
  instructions: "Collect from the kiosk, not the shop.",
}

/** In kobo, as Paystack transfers it. */
const kobo = (naira: number) => Math.round(naira * 100)

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })
    const { ada, offerId, owner, sellerId } = buyer
    const status = (request: Promise<unknown>) =>
      request.then(
        () => 200,
        (e: any) => e.response?.status as number
      )
    const errorOf = (request: Promise<unknown>) =>
      request.then(
        () => null,
        (e: any) => ({ status: e.response?.status as number, message: e.response?.data?.message as string })
      )

    const staff = async (shop: Shop) => vendorHeaders(api, shop.staff.email, SEED_PASSWORD, await sellerId(shop))
    // The runner restores the database to how the top-level beforeAll left it before each test,
    // so a test sets any collection point it needs.
    const setCollectionPoint = async (shop: Shop, body: unknown = AT_THE_SHOP) =>
      api.post("/vendor/collection-point", body, await owner(shop))

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

    describe("the collection point", () => {
      it("follows the shop's pickup address while the box is ticked, with the shop's instructions and phone", async () => {
        const { data } = await setCollectionPoint(GROCERY)

        expect(data.collection_point).toEqual({
          follows_pickup_address: true,
          address: {
            address_1: GROCERY.pickup.address_1,
            address_2: null,
            city: GROCERY.pickup.city,
            province: GROCERY.pickup.province,
            postal_code: null,
            country_code: "ng",
            landmark: GROCERY.pickup.landmark,
          },
          instructions: AT_THE_SHOP.instructions,
          phone: AT_THE_SHOP.phone,
        })

        // The shop moves: the collection point moves with it.
        const moved = { ...KIOSK.address, phone: "+2348031234501", first_name: "Bisi", last_name: "Adeyemi" }
        await api.post("/vendor/onboarding/pickup-address", moved, await owner(GROCERY))
        const { data: after } = await api.get("/vendor/collection-point", await owner(GROCERY))
        expect(after.collection_point.address).toMatchObject({
          address_1: KIOSK.address.address_1,
          landmark: KIOSK.address.metadata.landmark,
        })
      })

      it("takes a separate address, pinned, without asking Shipbubble: no courier goes there", async () => {
        const { data } = await setCollectionPoint(GROCERY, KIOSK)

        expect(data.collection_point).toMatchObject({
          follows_pickup_address: false,
          address: { address_1: KIOSK.address.address_1, city: "Surulere", landmark: KIOSK.address.metadata.landmark },
          instructions: KIOSK.instructions,
          phone: null,
        })
        expect(shipbubble.validations()).toEqual([])
        // An unticked box needs an address, pinned on the map.
        const { metadata: _pin, ...unpinned } = KIOSK.address
        expect(await status(setCollectionPoint(GROCERY, { ...KIOSK, address: unpinned }))).toBe(400)
        expect(await status(setCollectionPoint(GROCERY, { ...KIOSK, address: undefined }))).toBe(400)
      })

      it("can't be set by a shop without opening hours, and says so", async () => {
        const hours = getContainer().resolve<ShopHoursModuleService>(SHOP_HOURS_MODULE)
        const [weekly] = await hours.listShopWeeklyHours({ seller_id: await sellerId(GROCERY) })
        await hours.deleteShopWeeklyHours(weekly.id)

        const refused = await errorOf(setCollectionPoint(GROCERY))

        expect(refused).toEqual({ status: 400, message: expect.stringMatching(/opening hours/i) })
        const { data } = await api.get("/vendor/collection-point", await owner(GROCERY))
        expect(data).toEqual({ collection_point: null, has_hours: false })
      })

      it("is set by owners and managers only", async () => {
        expect(await status(setCollectionPoint(GROCERY, AT_THE_SHOP).then(() => undefined))).toBe(200)
        expect(await status(api.post("/vendor/collection-point", AT_THE_SHOP, await staff(GROCERY)))).toBe(403)
      })
    })

    /** A cart of rice from the grocery shop and a lantern from the gadget hub. */
    const adasCart = buyer.adasCart
    const shopIn = async (checkout: any, shop: Shop) => {
      const id = await sellerId(shop)
      return checkout.sellers.find((g: any) => g.seller.id === id)
    }
    const prepare = (cartId: string, body: Record<string, unknown>) => api.post(`/store/carts/${cartId}/checkout`, body, ada())
    /** Pays for a prepared cart; returns the shops' orders. */
    const pay = async (cartId: string) => {
      const { data } = await api.post(`/store/carts/${cartId}/checkout/payment`, { return_url: RETURN_URL }, ada())
      paystack.pay(data.payment.reference)
      await buyer.postWebhook(paystack.chargeSuccess(data.payment.reference))
      const groupId = await buyer.orderGroupOf(cartId)
      await buyer.capturedWithin(cartId)
      return { groupId, reference: data.payment.reference as string, orderOf: (shop: Shop) => buyer.shopOrderId(shop, cartId) }
    }
    const vendorOrder = async (shop: Shop, orderId: string) =>
      (await api.get(`/vendor/orders/${orderId}`, await owner(shop))).data.order
    const fulfilmentOf = async (shop: Shop, orderId: string) =>
      (await eventually(() => vendorOrder(shop, orderId), (o) => !!o.fulfilment)).fulfilment

    describe("checking out with pickup", () => {
      beforeEach(() => setCollectionPoint(GROCERY))

      it("offers pickup, free, for each shop with a collection point, with delivery still preselected", async () => {
        const cartId = await adasCart()

        const { data } = await prepare(cartId, { shipping_address: ADDRESS })

        const grocery = await shopIn(data.checkout, GROCERY)
        expect(grocery.method).toBe("delivery")
        expect(grocery.shipping).toMatchObject({ amount: BEST_VALUE_FEE })
        expect(grocery.pickup).toEqual({
          follows_pickup_address: true,
          address: expect.objectContaining({ address_1: GROCERY.pickup.address_1, landmark: GROCERY.pickup.landmark }),
          instructions: AT_THE_SHOP.instructions,
          phone: AT_THE_SHOP.phone,
          weekly: GROCERY.hours,
          time_zone: "Africa/Lagos",
          hold_notice: PICKUP_HOLD_NOTICE,
        })
        expect((await shopIn(data.checkout, GADGETS)).pickup).toBeNull()
      })

      it("places one order of each method from a checkout with a delivery shop and a pickup shop", async () => {
        const cartId = await adasCart()

        const { data } = await prepare(cartId, { shipping_address: ADDRESS, pickup: [await sellerId(GROCERY)] })

        const grocery = await shopIn(data.checkout, GROCERY)
        expect(grocery).toMatchObject({ method: "pickup", shipping: null })
        expect((await shopIn(data.checkout, GADGETS)).method).toBe("delivery")
        // Pickup is free: Ada pays for the gadget hub's delivery only.
        expect(data.checkout.total).toBe(LANTERN.price + 2 * RICE.price + BEST_VALUE_FEE)
        expect(data.checkout.ready_to_pay).toBe(true)
        // Only the delivered shop is quoted.
        expect(shipbubble.rateRequests()).toHaveLength(1)

        const { orderOf } = await pay(cartId)
        expect(await fulfilmentOf(GROCERY, await orderOf(GROCERY))).toMatchObject({ method: "pickup", state: "new" })
        expect(await fulfilmentOf(GADGETS, await orderOf(GADGETS))).toMatchObject({ method: "delivery", state: "new" })
      })

      it("needs no delivery address, and no Shipbubble, when every shop is pickup: only a name and phone", async () => {
        await setCollectionPoint(GADGETS)
        const cartId = await adasCart()
        const pickup = [await sellerId(GROCERY), await sellerId(GADGETS)]

        expect(await status(prepare(cartId, { pickup }))).toBe(400)
        const { data } = await prepare(cartId, { contact: CONTACT, pickup })

        expect(data.checkout).toMatchObject({
          shipping_address: null,
          contact: CONTACT,
          shipping_total: 0,
          total: LANTERN.price + 2 * RICE.price,
          ready_to_pay: true,
        })
        expect(shipbubble.validations()).toEqual([])
        expect(shipbubble.rateRequests()).toEqual([])

        const { orderOf } = await pay(cartId)
        for (const shop of [GROCERY, GADGETS]) {
          expect(await fulfilmentOf(shop, await orderOf(shop))).toMatchObject({ method: "pickup" })
        }
      })

      it("refuses delivery without an address, and pickup at a shop without a collection point", async () => {
        const cartId = await adasCart()

        // The gadget hub is still delivered.
        expect(await status(prepare(cartId, { contact: CONTACT, pickup: [await sellerId(GROCERY)] }))).toBe(400)
        expect(await status(prepare(cartId, { shipping_address: ADDRESS, pickup: [await sellerId(GADGETS)] }))).toBe(400)
      })

      it("can't switch method once paid", async () => {
        const cartId = await adasCart()
        await prepare(cartId, { shipping_address: ADDRESS, pickup: [await sellerId(GROCERY)] })
        await pay(cartId)

        expect(await status(prepare(cartId, { shipping_address: ADDRESS }))).toBe(400)
      })
    })

    describe("fresh items no courier can bring in time", () => {
      // Every courier takes days.
      beforeEach(() => shipbubble.setCouriers([COURIERS.slow]))
      afterEach(() => shipbubble.setCouriers(Object.values(COURIERS)))

      const freshCart = async () => {
        const { data } = await api.post("/store/carts", { region_id: buyer.regionId() }, ada())
        const cartId = data.cart.id as string
        await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await offerId(GROCERY, TOMATOES.title), quantity: 1 }, ada())
        await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await offerId(GADGETS, LANTERN.title), quantity: 1 }, ada())
        return cartId
      }

      it("switch that shop to pickup when it has a collection point, saying why", async () => {
        await setCollectionPoint(GROCERY)
        const cartId = await freshCart()

        const { data } = await prepare(cartId, { shipping_address: ADDRESS })

        const grocery = await shopIn(data.checkout, GROCERY)
        expect(grocery).toMatchObject({ method: "pickup", pickup_note: PERISHABLE_PICKUP_NOTE, shipping: null })
        expect(grocery.delivery_unavailable).toMatchObject({ code: "perishable_too_slow" })
        expect((await shopIn(data.checkout, GADGETS)).method).toBe("delivery")
        expect(data.checkout.ready_to_pay).toBe(true)

        const { orderOf } = await pay(cartId)
        expect(await fulfilmentOf(GROCERY, await orderOf(GROCERY))).toMatchObject({ method: "pickup" })
      })

      it("need no address once the buyer collects from every other shop too", async () => {
        await setCollectionPoint(GROCERY)
        await setCollectionPoint(GADGETS)
        const cartId = await freshCart()
        await prepare(cartId, { shipping_address: ADDRESS })

        // The grocery was switched to pickup; Ada collects the lantern too, and gives no address.
        const { data } = await prepare(cartId, { contact: CONTACT, pickup: [await sellerId(GADGETS)] })

        expect(data.checkout).toMatchObject({ shipping_address: null, contact: CONTACT, shipping_total: 0, ready_to_pay: true })
        expect(data.checkout.sellers.map((g: any) => g.method)).toEqual(["pickup", "pickup"])
        const { orderOf } = await pay(cartId)
        for (const shop of [GROCERY, GADGETS]) {
          expect(await fulfilmentOf(shop, await orderOf(shop))).toMatchObject({ method: "pickup" })
        }
      })

      it("let the buyer remove the fresh items and have the rest delivered", async () => {
        await setCollectionPoint(GROCERY)
        const cartId = await freshCart()
        await prepare(cartId, { shipping_address: ADDRESS })
        await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await offerId(GROCERY, RICE.title), quantity: 1 }, ada())
        const { data: cart } = await api.get(`/store/carts/${cartId}/sellers`, { headers: buyer.headers() })
        const tomatoLine = cart.cart.sellers.flatMap((g: any) => g.items).find((i: any) => i.product_title === TOMATOES.title)
        await api.delete(`/store/carts/${cartId}/line-items/${tomatoLine.id}`, ada())

        const { data } = await prepare(cartId, { shipping_address: ADDRESS })

        expect(await shopIn(data.checkout, GROCERY)).toMatchObject({ method: "delivery", pickup_note: null })
      })

      it("still refuse the checkout for a shop without a collection point", async () => {
        const cartId = await freshCart()

        const { data } = await prepare(cartId, { shipping_address: ADDRESS })

        const grocery = await shopIn(data.checkout, GROCERY)
        expect(grocery).toMatchObject({ method: "delivery", pickup: null, shipping: null })
        expect(grocery.delivery_unavailable).toMatchObject({ code: "perishable_too_slow" })
        expect(data.checkout.ready_to_pay).toBe(false)
        expect(await status(api.post(`/store/carts/${cartId}/checkout/payment`, { return_url: RETURN_URL }, ada()))).toBe(400)
      })
    })

    describe("handing over at the counter", () => {
      beforeEach(async () => {
        // The buyer's push gives the shop's hours; open round the clock, they don't depend on when the test runs.
        await setWeeklyHours(getContainer(), await sellerId(GROCERY), ALWAYS_OPEN)
        await setCollectionPoint(GROCERY)
      })

      const post = async (shop: Shop, path: string, body = {}, as?: unknown) =>
        api.post(`/vendor/orders/${path}`, body, as ?? (await owner(shop)))
      /** Ada's order from the grocery (two bags of rice, and any `fresh` tomatoes), to collect in store, and its order group. */
      const pickupOrder = async ({ fresh = 0 } = {}) => {
        const cartId = await adasCart()
        if (fresh) {
          await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await offerId(GROCERY, TOMATOES.title), quantity: fresh }, ada())
        }
        await prepare(cartId, { shipping_address: ADDRESS, pickup: [await sellerId(GROCERY)] })
        const { groupId, reference, orderOf } = await pay(cartId)
        const orderId = await orderOf(GROCERY)
        await eventually(() => vendorOrder(GROCERY, orderId), (o) => o.fulfilment?.state === "new")
        return { orderId, groupId, reference, gadgetsOrderId: await orderOf(GADGETS) }
      }
      const packed = async (orderId: string, shop = GROCERY) => {
        await post(shop, `${orderId}/accept`)
        await post(shop, `${orderId}/start-picking`)
        const { pick_list } = (await api.get(`/vendor/orders/${orderId}/pick-list`, await owner(shop))).data
        for (const line of pick_list.lines) await post(shop, `${orderId}/pick-list/${line.id}`, { picked: line.quantity })
        return post(shop, `${orderId}/pack`)
      }
      /** The grocery's order as Ada sees it in her order history. */
      const adasOrder = async (groupId: string, orderId: string) => {
        const { data } = await api.get(`/store/order-history/${groupId}`, ada())
        return data.order_group.orders.find((o: any) => o.id === orderId)
      }
      const collect = (orderId: string, code: string, as?: unknown) =>
        post(GROCERY, `${orderId}/collect`, { code, collected_by: "Tunde Bakare" }, as)
      const wrongCodeFor = (code: string) => (code === "000000" ? "111111" : "000000")

      it("lands a packed pickup order in Ready for pickup, issuing its code only then, in the buyer's order alone", async () => {
        const { orderId, groupId } = await pickupOrder()
        const before = await adasOrder(groupId, orderId)
        expect(before.pickup).toMatchObject({ code: null, instructions: AT_THE_SHOP.instructions })

        const { data } = await packed(orderId)

        expect(data.fulfilment).toMatchObject({ method: "pickup", state: "ready_for_pickup" })
        const after = await adasOrder(groupId, orderId)
        expect(after.fulfilment.state).toBe("ready_for_pickup")
        expect(after.pickup.code).toMatch(/^\d{6}$/)
        expect(after.fulfilment.timeline.map((s: any) => s.label)).toEqual([
          "Order placed",
          "Accepted",
          "Being prepared",
          "Ready for pickup",
          "Collected",
        ])
        // Staff never see it.
        expect(JSON.stringify(await vendorOrder(GROCERY, orderId))).not.toContain(after.pickup.code)
      })

      it("pushes the buyer once the order is ready, with the address and hours, the code being in the app", async () => {
        const device = pushToken()
        await api.post("/store/push-tokens", { token: device }, ada())
        const { orderId, groupId } = await pickupOrder()

        await packed(orderId)

        // The buyer was told of the confirmation and the acceptance first (#5).
        const ready = (sent: PushMessage[]) => sent.find((p) => /ready for pickup/i.test(p.title ?? ""))
        const push = ready(await eventually(async () => expo.sentTo(device), (sent) => !!ready(sent)))!
        expect(push).toMatchObject({
          title: expect.stringMatching(/ready for pickup/i),
          body: expect.stringContaining(GROCERY.pickup.address_1),
          data: { url: `/order/${groupId}`, order_id: orderId },
        })
        expect(push.body).toMatch(/code is in the/i)
        expect(push.body).toContain(GROCERY.pickup.landmark)
        expect(push.body).toContain(`Hours: ${openingHoursLines(ALWAYS_OPEN).join("; ")}.`)
        await api.delete(`/store/push-tokens/${encodeURIComponent(device)}`, ada())
      })

      it("collects the order with the right code, recording the member and the collector's name, and makes it payout-eligible", async () => {
        const { orderId, groupId } = await pickupOrder()
        await packed(orderId)
        const { code } = (await adasOrder(groupId, orderId)).pickup

        // Any member who works on orders hands over.
        const { data } = await collect(orderId, code, await staff(GROCERY))

        expect(data.fulfilment).toMatchObject({
          method: "pickup",
          state: "collected",
          collection: { staff: { name: `${GROCERY.staff.first_name} ${GROCERY.staff.last_name}`, at: expect.any(String) }, collected_by: "Tunde Bakare" },
        })
        expect((await vendorOrder(GROCERY, orderId)).fulfilment.timeline.at(-1)).toMatchObject({ label: "Collected", status: "done" })
        expect((await adasOrder(groupId, orderId)).fulfilment.state).toBe("collected")

        // Paid like a delivered order, with no delivery fee to keep back.
        const goods = 2 * RICE.price
        const { data: payout } = await api.get(`/vendor/orders/${orderId}/payout`, await owner(GROCERY))
        expect(payout.payout).toMatchObject({ state: "due", paid: goods, delivery: 0, commission: goods / 10 })
        await payOutDeliveredOrders(getContainer())
        const transfer = paystack.transfers().find((t) => t.reference === `payout_${orderId}`.toLowerCase())
        expect(transfer).toMatchObject({ amount: kobo(goods) - Math.round(kobo(goods) / 10) })
      })

      it("lets the buyer review the shop once the order is collected, not while ready for pickup (#7)", async () => {
        const { orderId, groupId } = await pickupOrder()
        await packed(orderId)
        const reviewShop = async () =>
          api.post("/store/reviews", { order_id: orderId, reference: "seller", reference_id: await sellerId(GROCERY), rating: 5 }, ada())
        const ready = await adasOrder(groupId, orderId)
        const tooEarly = await status(reviewShop())

        await collect(orderId, ready.pickup.code)

        expect(ready.can_review).toBe(false)
        expect(tooEarly).toBe(400)
        expect((await adasOrder(groupId, orderId)).can_review).toBe(true)
        expect((await reviewShop()).data.review).toMatchObject({ reference: "seller", rating: 5, status: "pending" })
      })

      it("refuses a wrong code, and the sixth wrong try within 15 minutes even with the right code", async () => {
        const { orderId, groupId } = await pickupOrder()
        await packed(orderId)
        const { code } = (await adasOrder(groupId, orderId)).pickup
        const wrong = wrongCodeFor(code)

        for (let i = 0; i < 5; i++) expect(await status(collect(orderId, wrong))).toBe(400)

        expect(await status(collect(orderId, code))).toBe(429)
        expect((await vendorOrder(GROCERY, orderId)).fulfilment.state).toBe("ready_for_pickup")
      })

      it("refuses a code before the order is ready", async () => {
        const { orderId, groupId } = await pickupOrder()
        expect((await adasOrder(groupId, orderId)).pickup.code).toBeNull()

        for (const code of ["000000", "123456"]) expect(await status(collect(orderId, code))).toBe(400)
        await post(GROCERY, `${orderId}/accept`)
        expect(await status(collect(orderId, "123456"))).toBe(400)
      })

      it("refuses a code once collected, and on a delivery order", async () => {
        const { orderId, groupId, gadgetsOrderId } = await pickupOrder()
        await packed(orderId)
        const { code } = (await adasOrder(groupId, orderId)).pickup
        await collect(orderId, code)

        expect(await status(collect(orderId, code))).toBe(400)

        await packed(gadgetsOrderId, GADGETS)
        const onDelivery = api.post(
          `/vendor/orders/${gadgetsOrderId}/collect`,
          { code: "123456", collected_by: "Tunde" },
          await owner(GADGETS)
        )
        expect(await status(onDelivery)).toBe(400)
        expect((await vendorOrder(GADGETS, gadgetsOrderId)).fulfilment.state).toBe("packed")
        expect((await adasOrder(groupId, gadgetsOrderId)).pickup).toBeNull()
      })

      it("needs the collector's name", async () => {
        const { orderId } = await pickupOrder()
        expect(await status(post(GROCERY, `${orderId}/collect`, { code: "123456" }))).toBe(400)
        expect(await status(post(GROCERY, `${orderId}/collect`, { code: "123456", collected_by: " " }))).toBe(400)
      })

      it("lists only the shop's orders ready for pickup, whatever their age, to any member who works on orders", async () => {
        const { orderId } = await pickupOrder()
        await packed(orderId)
        const { orderId: notReady } = await pickupOrder()

        const { data } = await api.get("/vendor/ready-for-pickup", await staff(GROCERY))

        expect(data.order_ids).toEqual([orderId])
        expect(data.order_ids).not.toContain(notReady)
        expect((await api.get("/vendor/ready-for-pickup", await owner(GADGETS))).data.order_ids).toEqual([])
      })

      it("refuses label booking on a pickup order", async () => {
        const { orderId } = await pickupOrder()
        await packed(orderId)

        expect(await status(post(GROCERY, `${orderId}/book-label`))).toBe(400)
      })

      describe("when nobody collects it (#32)", () => {
        const DAY_MS = 24 * 60 * 60 * 1000
        const lagosDate = (instant: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date(instant))
        /** Midnight in Lagos `days` after the day of `instant`: when a shop open round the clock closes on that day's eve. */
        const lagosMidnightAfter = (instant: string, days: number) =>
          new Date(Date.parse(`${lagosDate(instant)}T00:00:00+01:00`) + days * DAY_MS).toISOString()
        const readyAt = async (orderId: string) =>
          (await vendorOrder(GROCERY, orderId)).fulfilment.timeline.find((s: any) => s.label === "Ready for pickup").at as string
        /** The order's lines as it was placed. */
        const linesOf = async (orderId: string) => {
          const { data } = await buyer.query().graph({ entity: "order", fields: ["items.id", "items.product_title"], filters: { id: orderId } })
          return (data[0].items ?? []) as { id: string; product_title: string }[]
        }
        /** The stock reserved for each of these lines, by product title; a line taken off the order has none. */
        const reservedOf = async (items: { id: string; product_title: string }[]) => {
          const reservations = await getContainer()
            .resolve(Modules.INVENTORY)
            .listReservationItems({ line_item_id: items.map((i) => i.id) })
          return Object.fromEntries(
            items.map((i) => [
              i.product_title,
              reservations.filter((r) => r.line_item_id === i.id).reduce((sum, r) => sum + Number(r.quantity), 0),
            ])
          )
        }
        const settleRefunds = async (reference: string) => {
          for (const refund of paystack.refundsOf(reference).filter((r) => r.status === "pending")) {
            paystack.settleRefund(refund.id, "processed")
            await buyer.postWebhook(paystack.refundEvent(refund.id))
          }
        }
        const payoutOf = async (orderId: string) => (await api.get(`/vendor/orders/${orderId}/payout`, await owner(GROCERY))).data.payout
        /** The hold-expiry job, run long after any hold has ended. */
        const longAfter = (instant: string) => expirePickupHolds(getContainer(), new Date(Date.parse(instant) + 30 * DAY_MS))

        it("shows the buyer and the shop when to collect by: closing on the 5th open day after Ready", async () => {
          const { orderId, groupId } = await pickupOrder()
          await packed(orderId)
          const ready = await readyAt(orderId)

          // Open round the clock, so each open day closes at midnight.
          const collectBy = { at: lagosMidnightAfter(ready, 6), time_zone: "Africa/Lagos" }
          expect((await adasOrder(groupId, orderId)).fulfilment.collect_by).toEqual(collectBy)
          expect((await vendorOrder(GROCERY, orderId)).fulfilment.collect_by).toEqual(collectBy)
        })

        it("holds an order with fresh items only until closing on the next open day", async () => {
          const { orderId, groupId } = await pickupOrder({ fresh: 1 })
          await packed(orderId)

          expect((await adasOrder(groupId, orderId)).fulfilment.collect_by.at).toBe(lagosMidnightAfter(await readyAt(orderId), 2))
        })

        it("leaves an order whose hold hasn't ended ready for pickup", async () => {
          const { orderId } = await pickupOrder()
          await packed(orderId)

          await expirePickupHolds(getContainer(), new Date(Date.parse(lagosMidnightAfter(await readyAt(orderId), 6)) - 60 * 1000))

          expect((await vendorOrder(GROCERY, orderId)).fulfilment.state).toBe("ready_for_pickup")
        })

        it("moves an expired order to Not collected, refunding it in full and returning its stock, with no payout", async () => {
          const { orderId, groupId, reference } = await pickupOrder()
          await packed(orderId)
          const { code } = (await adasOrder(groupId, orderId)).pickup
          const lines = await linesOf(orderId)
          expect(await reservedOf(lines)).toEqual({ [RICE.title]: 2 })

          await longAfter(await readyAt(orderId))

          const fulfilment = await vendorOrder(GROCERY, orderId).then((o) => o.fulfilment)
          expect(fulfilment).toMatchObject({ method: "pickup", state: "not_collected", collect_by: null })
          expect(fulfilment.timeline.at(-1)).toMatchObject({ label: "Not collected", status: "done" })
          expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([kobo(2 * RICE.price)])
          expect(await reservedOf(lines)).toEqual({ [RICE.title]: 0 })
          const adas = await adasOrder(groupId, orderId)
          expect(adas.fulfilment.state).toBe("not_collected")
          expect(adas.refund).toMatchObject({ amount: 2 * RICE.price })
          expect(adas.pickup.code).toBeNull()
          await settleRefunds(reference)
          expect((await payoutOf(orderId)).state).toBe("not_due")
          // Final: the code no longer works, and the job leaves it be.
          expect(await status(collect(orderId, code))).toBe(400)
          await longAfter(await readyAt(orderId))
          expect(paystack.refundsOf(reference)).toHaveLength(1)
        })

        it("keeps the fresh items for the shop, unrefunded and their stock not returned, and pays them out less 10%", async () => {
          const { orderId, groupId, reference } = await pickupOrder({ fresh: 1 })
          await packed(orderId)
          const lines = await linesOf(orderId)

          await longAfter(await readyAt(orderId))

          expect((await vendorOrder(GROCERY, orderId)).fulfilment.state).toBe("not_collected")
          // The rice is refunded and its stock returned; the tomatoes are neither.
          expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([kobo(2 * RICE.price)])
          expect(await reservedOf(lines)).toEqual({ [RICE.title]: 0, [TOMATOES.title]: 1 })
          expect((await adasOrder(groupId, orderId)).refund).toMatchObject({ amount: 2 * RICE.price })
          await settleRefunds(reference)
          expect(await eventually(() => payoutOf(orderId), (p) => p.state !== "waiting_for_refund")).toMatchObject({
            state: "due",
            paid: 2 * RICE.price + TOMATOES.price,
            refunded: 2 * RICE.price,
            delivery: 0,
            commission: TOMATOES.price / 10,
            amount: TOMATOES.price - TOMATOES.price / 10,
          })
          await payOutDeliveredOrders(getContainer())
          const transfer = paystack.transfers().find((t) => t.reference === `payout_${orderId}`.toLowerCase())
          expect(transfer).toMatchObject({ amount: kobo(TOMATOES.price) - Math.round(kobo(TOMATOES.price) / 10) })
        })
      })
    })

    describe("removing the collection point", () => {
      beforeEach(() => setCollectionPoint(GROCERY))
      const remove = async (as?: unknown) => api.delete("/vendor/collection-point", as ?? (await owner(GROCERY)))

      it("stops the shop offering pickup, even to a cart that had chosen it", async () => {
        const cartId = await adasCart()
        await prepare(cartId, { shipping_address: ADDRESS, pickup: [await sellerId(GROCERY)] })

        const { data } = await remove()

        expect(data).toEqual({ collection_point: null, has_hours: true })
        const { data: again } = await api.get(`/store/carts/${cartId}/checkout`, ada())
        expect(await shopIn(again.checkout, GROCERY)).toMatchObject({ method: "delivery", pickup: null })
        expect(again.checkout.ready_to_pay).toBe(false)
        expect(await status(prepare(cartId, { shipping_address: ADDRESS, pickup: [await sellerId(GROCERY)] }))).toBe(400)
        const { data: delivered } = await prepare(cartId, { shipping_address: ADDRESS })
        expect(await shopIn(delivered.checkout, GROCERY)).toMatchObject({ method: "delivery", shipping: { amount: BEST_VALUE_FEE } })
      })

      it("is refused while an order is still to be collected there", async () => {
        const cartId = await adasCart()
        await prepare(cartId, { shipping_address: ADDRESS, pickup: [await sellerId(GROCERY)] })
        await pay(cartId)

        const refused = await errorOf(remove())

        expect(refused).toEqual({ status: 400, message: expect.stringMatching(/to collect/i) })
        expect((await api.get("/vendor/collection-point", await owner(GROCERY))).data.collection_point).not.toBeNull()
      })

      it("is for owners and managers only", async () => {
        expect(await status(remove(await staff(GROCERY)))).toBe(403)
      })
    })
  },
})
