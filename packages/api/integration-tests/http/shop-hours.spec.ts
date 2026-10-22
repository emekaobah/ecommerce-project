import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import seedDemoData from "../../src/scripts/seed"
import { SHOP_HOURS_MODULE, type ShopHoursModuleService } from "../../src/modules/shop-hours"
import { SEED_PASSWORD } from "../../src/scripts/seed-data"
import { adminHeaders, vendorHeaders } from "../helpers/auth"
import { buyerCheckout, GADGETS, LANTERN } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakePaystack } from "../helpers/paystack"
import { COURIERS, fakeShipbubble, LATER_PICKUP_TIME } from "../helpers/shipbubble"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so the fakes can be named in the config before they listen.
const paystack = fakePaystack(61000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(62000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers each provider only when its key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl

const DAY = 24 * 60 * 60 * 1000
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const

/** The date in Lagos (the seeded region's timezone) `days` after `from` (now), YYYY-MM-DD. */
const lagosDate = (days: number, from = Date.now()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(from + days * DAY)
/** A Lagos local time on a date, as the API answers instants. */
const lagosInstant = (date: string, time: string) => new Date(`${date}T${time}:00+01:00`).toISOString()

const weekly = (hours: (day: (typeof WEEKDAYS)[number]) => { opens: string; closes: string }[]) =>
  Object.fromEntries(WEEKDAYS.map((day) => [day, hours(day)]))
/** Open round the clock: the shop is open whenever a test runs. */
const ALWAYS_OPEN = weekly(() => [{ opens: "00:00", closes: "24:00" }])
/** Open 8am to 6pm, only on the weekday two days from now: closed whenever a test runs. */
const onlyTheDayAfterTomorrow = (date = lagosDate(2)) => {
  const day = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]
  return weekly((d) => (d === day ? [{ opens: "08:00", closes: "18:00" }] : []))
}

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })
    const { ada, sellerId, offerId, owner, prepare, startPayment, checkout } = buyer

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start()])
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop()]))

    let gadgets: Awaited<ReturnType<typeof owner>>
    let gadgetsId: string

    // Each test starts with the gadget hub open, no exceptions and not paused.
    beforeEach(async () => {
      await buyer.load()
      shipbubble.reset()
      gadgets = await owner(GADGETS)
      gadgetsId = await sellerId(GADGETS)
      await api.post("/vendor/shop-hours/weekly", { weekly: ALWAYS_OPEN }, gadgets)
      await api.post("/vendor/shop-hours/resume", {}, gadgets)
      const { data } = await api.get("/vendor/shop-hours", gadgets)
      for (const exception of data.shop_hours.exceptions) {
        await api.delete(`/vendor/shop-hours/exceptions/${exception.id}`, gadgets)
      }
    })

    const status = (request: Promise<unknown>) =>
      request.then(
        () => 200,
        (e: any) => e.response?.status as number
      )
    const store = () => ({ headers: buyer.headers() })
    const region = () => `region_id=${buyer.regionId()}`

    /**
     * The gadget hub as buyers see it: in the feed, search and category results, on its shop
     * page with its own listings, and on the lantern's page. A closed shop stays listed (ADR 0004).
     */
    const gadgetsSeenByBuyers = async () => {
      const listed = async (params: string) => {
        const { data } = await api.get(`/store/listings?${region()}&limit=100&${params}`, store())
        return data.listings.find((l: any) => l.seller.id === gadgetsId)?.seller.shop_status
      }
      const query = buyer.query()
      const products = await query.graph({ entity: "product", fields: ["id"], filters: { title: LANTERN.title } })
      const categories = await query.graph({
        entity: "product_category",
        fields: ["id"],
        filters: { name: "Power & Lighting" },
      })
      const { data: listing } = await api.get(`/store/listings/${gadgetsId}/${products.data[0].id}?${region()}`, store())
      const { data: shop } = await api.get(`/store/shops/${gadgetsId}?${region()}`, store())
      const { data: home } = await api.get(`/store/shops?${region()}&limit=50`, store())
      return {
        home: home.shops.find((s: any) => s.id === gadgetsId)?.shop_status,
        feed: await listed(""),
        search: await listed("q=lantern"),
        category: await listed(`category_id=${categories.data[0].id}`),
        shop: shop.shop.shop_status,
        shop_listings: await listed(`seller_id=${gadgetsId}`),
        listing: listing.listing.seller.shop_status,
      }
    }
    const everywhere = (status: unknown) => ({
      home: status,
      feed: status,
      search: status,
      category: status,
      shop: status,
      shop_listings: status,
      listing: status,
    })

    const newCart = async () => {
      const { data } = await api.post("/store/carts", { region_id: buyer.regionId() }, ada())
      return data.cart.id as string
    }
    const addLantern = async (cartId: string) =>
      api.post(`/store/carts/${cartId}/line-items`, { offer_id: await offerId(GADGETS, LANTERN.title), quantity: 1 }, ada())

    describe("an open shop", () => {
      it("says when it closes today wherever its status shows: to buyers, in the cart and to the shop", async () => {
        // Open all of today, closed tomorrow: whenever the test runs, the shop closes at midnight.
        const today = WEEKDAYS[new Date(`${lagosDate(0)}T00:00:00Z`).getUTCDay()]
        await api.post("/vendor/shop-hours/weekly", { weekly: weekly((d) => (d === today ? [{ opens: "00:00", closes: "24:00" }] : [])) }, gadgets)

        const open = {
          state: "open",
          closes_at: lagosInstant(lagosDate(1), "00:00"),
          orderable: true,
          label: "Open · closes midnight",
        }
        expect(await gadgetsSeenByBuyers()).toEqual(everywhere(open))
        const cartId = await newCart()
        await addLantern(cartId)
        const { data: cart } = await api.get(`/store/carts/${cartId}/sellers`, ada())
        expect(cart.cart.sellers[0].shop_status).toEqual(open)
        const { data: vendor } = await api.get("/vendor/shop-hours", gadgets)
        expect(vendor.shop_hours.status).toEqual(open)
      })

      it("open round the clock, has no closing time", async () => {
        const { data } = await api.get("/vendor/shop-hours", gadgets)

        expect(data.shop_hours.status).toEqual({ state: "open", closes_at: null, orderable: true, label: "Open" })
      })
    })

    describe("a shop outside its regular hours", () => {
      it("is listed as closed with when it next opens, and still takes orders", async () => {
        await api.post("/vendor/shop-hours/weekly", { weekly: onlyTheDayAfterTomorrow() }, gadgets)

        const seen = await gadgetsSeenByBuyers()

        const closed = {
          state: "closed",
          opens_at: lagosInstant(lagosDate(2), "08:00"),
          orderable: true,
          label: expect.stringMatching(/^Closed · opens 8am /),
        }
        expect(seen).toEqual(everywhere(closed))

        const cartId = await newCart()
        expect(await status(addLantern(cartId))).toBe(200)
        await prepare(cartId)
        const prepared = await checkout(cartId)
        // Checkout tells the buyer the order is prepared when the shop opens.
        expect(prepared.sellers[0].shop_status).toEqual(closed)
        expect(prepared.ready_to_pay).toBe(true)
        expect((await startPayment(cartId)).authorization_url).toEqual(expect.any(String))
      })
    })

    describe("delivery estimates (ADR 0004)", () => {
      const HOUR = 60 * 60 * 1000
      /** The gadget hub's delivery choices for a lantern, as checkout quotes them. */
      const quoted = async () => {
        const cartId = await newCart()
        await addLantern(cartId)
        await prepare(cartId)
        return (await checkout(cartId)).sellers[0]
      }
      const etaOf = (group: any, courier: { courier_name: string }) =>
        group.delivery_choices.find((c: any) => c.courier_name === courier.courier_name).delivery_eta_time as string

      it("count from the shop's next opening when it is outside its hours", async () => {
        // Read once: past midnight the shop still opens on this date, a day nearer.
        const opensOn = lagosDate(2)
        await api.post("/vendor/shop-hours/weekly", { weekly: onlyTheDayAfterTomorrow(opensOn) }, gadgets)

        const group = await quoted()

        // Couriers are asked to collect on the day it opens, and Shipbubble counts from then.
        expect(shipbubble.rateRequests().map((r) => r.pickup_date)).toEqual([opensOn])
        const collected = Date.parse(`${opensOn}T${LATER_PICKUP_TIME}+01:00`)
        expect(Date.parse(etaOf(group, COURIERS.express))).toBe(collected + COURIERS.express.hours * HOUR)
        expect(Date.parse(group.shipping.delivery_eta_time)).toBe(collected + COURIERS.nextDay.hours * HOUR)
        expect(group.shipping.delivery_eta_time).toMatch(/\+01:00$/)
      })

      it("move later by the gap when the courier would collect before the shop opens", async () => {
        // Open from 10am on the day after tomorrow; the fake's couriers collect at 9am that day.
        const opensOn = lagosDate(2)
        const day = WEEKDAYS[new Date(`${opensOn}T00:00:00Z`).getUTCDay()]
        const lateOpening = weekly((d) => (d === day ? [{ opens: "10:00", closes: "18:00" }] : []))
        await api.post("/vendor/shop-hours/weekly", { weekly: lateOpening }, gadgets)

        const group = await quoted()

        expect(shipbubble.rateRequests().map((r) => r.pickup_date)).toEqual([opensOn])
        const opens = Date.parse(lagosInstant(opensOn, "10:00"))
        expect(Date.parse(etaOf(group, COURIERS.express))).toBe(opens + COURIERS.express.hours * HOUR)
        expect(etaOf(group, COURIERS.express)).toMatch(/\+01:00$/)
      })

      it("count from now while the shop is open", async () => {
        const before = Date.now()
        const group = await quoted()
        const after = Date.now()

        // Today when the quote was asked for, whichever side of Lagos midnight that fell.
        expect([lagosDate(0, before), lagosDate(0, after)]).toContain(shipbubble.rateRequests()[0].pickup_date)
        expect(shipbubble.rateRequests()).toHaveLength(1)
        const express = Date.parse(etaOf(group, COURIERS.express))
        // Shipbubble writes ETAs to the second.
        expect(express).toBeGreaterThanOrEqual(before - 1000 + COURIERS.express.hours * HOUR)
        expect(express).toBeLessThanOrEqual(after + COURIERS.express.hours * HOUR)
      })
    })

    describe("a shop in a closed exception", () => {
      const closeTodayAndTomorrow = () =>
        api.post(
          "/vendor/shop-hours/exceptions",
          { starts_on: lagosDate(0), ends_on: lagosDate(1), closed: true, note: "Closed for stocktaking" },
          gadgets
        )

      it("is listed as closed until it reopens, with its note", async () => {
        await closeTodayAndTomorrow()

        const seen = await gadgetsSeenByBuyers()

        const closedUntil = {
          state: "closed_until",
          reason: "exception",
          until: lagosInstant(lagosDate(2), "00:00"),
          note: "Closed for stocktaking",
          orderable: false,
          label: expect.stringMatching(/^Closed until /),
        }
        expect(seen).toEqual(everywhere(closedUntil))
      })

      it("refuses its items in a cart, and payment for the items already there", async () => {
        const cartId = await newCart()
        await addLantern(cartId)
        await prepare(cartId)
        await closeTodayAndTomorrow()

        const added = await addLantern(await newCart()).catch((e) => e.response)
        const paid = await api
          .post(`/store/carts/${cartId}/checkout/payment`, { return_url: "https://api.oja.test/return" }, ada())
          .catch((e) => e.response)

        expect(added.status).toBe(400)
        expect(added.data.message).toMatch(/Ikeja Gadget Hub isn't taking orders\. Closed until .*\. Closed for stocktaking/)
        expect((await checkout(cartId)).ready_to_pay).toBe(false)
        expect(paid.status).toBe(400)
        expect(paid.data.message).toMatch(/Closed for stocktaking/)
      })

      it("can't overlap another closure or special hours", async () => {
        await closeTodayAndTomorrow()

        const res = await api
          .post(
            "/vendor/shop-hours/exceptions",
            { starts_on: lagosDate(1), ends_on: lagosDate(1), closed: false, periods: [{ opens: "10:00", closes: "12:00" }] },
            gadgets
          )
          .catch((e) => e.response)

        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/overlap/)
      })

      it("once removed after it started, still counts the days already past as closed", async () => {
        const shopHours = getContainer().resolve<ShopHoursModuleService>(SHOP_HOURS_MODULE)
        const started = await shopHours.createShopHoursExceptions({
          seller_id: gadgetsId,
          starts_on: lagosDate(-2),
          ends_on: lagosDate(1),
          closed: true,
          periods: [] as never,
          note: null,
        })

        await api.delete(`/vendor/shop-hours/exceptions/${started.id}`, gadgets)

        // Ended yesterday rather than deleted: the accept clock still knows the shop was closed.
        const [kept] = await shopHours.listShopHoursExceptions({ id: started.id })
        expect(kept).toMatchObject({ starts_on: lagosDate(-2), ends_on: lagosDate(-1) })
        expect((await api.get("/vendor/shop-hours", gadgets)).data.shop_hours.exceptions).toEqual([])
        expect(await status(addLantern(await newCart()))).toBe(200)
      })

      it("takes orders again once removed", async () => {
        const { data } = await closeTodayAndTomorrow()

        await api.delete(`/vendor/shop-hours/exceptions/${data.shop_hours.exceptions[0].id}`, gadgets)

        expect(await status(addLantern(await newCart()))).toBe(200)
      })
    })

    describe("a paused shop", () => {
      it("is listed as closed until the pause ends, with its note, and takes no orders until resumed", async () => {
        const until = new Date(Date.now() + 3 * 60 * 60 * 1000)
        until.setUTCSeconds(0, 0)

        const { data } = await api.post("/vendor/shop-hours/pause", { until: until.toISOString(), note: "Generator repairs" }, gadgets)

        expect(data.shop_hours.pause).toMatchObject({ ends_at: until.toISOString(), note: "Generator repairs" })
        const paused = {
          state: "closed_until",
          reason: "pause",
          until: until.toISOString(),
          note: "Generator repairs",
          orderable: false,
          label: expect.any(String),
        }
        expect(await gadgetsSeenByBuyers()).toEqual(everywhere(paused))
        expect((await addLantern(await newCart()).catch((e) => e.response)).status).toBe(400)

        const { data: resumed } = await api.post("/vendor/shop-hours/resume", {}, gadgets)

        expect(resumed.shop_hours.pause).toBeNull()
        expect(resumed.shop_hours.status.state).toBe("open")
        expect(await status(addLantern(await newCart()))).toBe(200)
      })

      it("refuses payment for the items already in a cart", async () => {
        const cartId = await newCart()
        await addLantern(cartId)
        await prepare(cartId)

        await api.post("/vendor/shop-hours/pause", {}, gadgets)

        const paid = await api
          .post(`/store/carts/${cartId}/checkout/payment`, { return_url: "https://api.oja.test/return" }, ada())
          .catch((e) => e.response)
        expect(paid.status).toBe(400)
        expect(paid.data.message).toMatch(/Ikeja Gadget Hub isn't taking orders\. Closed until further notice/)
      })

      it("tells the shop how many orders wait to be accepted before it pauses", async () => {
        const { data } = await api.get("/vendor/shop-hours", gadgets)

        expect(data.shop_hours).toMatchObject({ time_zone: "Africa/Lagos", new_orders: 0, pause: null })
      })
    })

    describe("the hours", () => {
      it("are refused when a day's times are wrong, or the shop never opens", async () => {
        const wrong = await api
          .post("/vendor/shop-hours/weekly", { weekly: { ...ALWAYS_OPEN, mon: [{ opens: "18:00", closes: "08:00" }] } }, gadgets)
          .catch((e) => e.response)
        const never = await api
          .post("/vendor/shop-hours/weekly", { weekly: weekly(() => []) }, gadgets)
          .catch((e) => e.response)

        expect(wrong.status).toBe(400)
        expect(wrong.data.message).toBe("Monday: closing time must be after opening time.")
        expect(never.status).toBe(400)
        expect(never.data.message).toBe("Add the hours you're open on at least one day.")
      })

      it("are changed and paused only by owners and managers; staff see them", async () => {
        const staff = await vendorHeaders(api, GADGETS.staff.email, SEED_PASSWORD, gadgetsId)
        const exception = { starts_on: lagosDate(5), ends_on: lagosDate(5), closed: true }

        expect(await status(api.get("/vendor/shop-hours", staff))).toBe(200)
        expect(await status(api.post("/vendor/shop-hours/weekly", { weekly: ALWAYS_OPEN }, staff))).toBe(403)
        expect(await status(api.post("/vendor/shop-hours/exceptions", exception, staff))).toBe(403)
        expect(await status(api.post("/vendor/shop-hours/pause", {}, staff))).toBe(403)
        expect(await status(api.post("/vendor/shop-hours/resume", {}, staff))).toBe(403)
        const { data } = await api.post("/vendor/shop-hours/exceptions", exception, gadgets)
        expect(await status(api.delete(`/vendor/shop-hours/exceptions/${data.shop_hours.exceptions[0].id}`, staff))).toBe(403)
        expect((await api.get("/vendor/shop-hours", gadgets)).data.shop_hours.exceptions).toHaveLength(1)
      })
    })

    describe("Mercur's closure fields", () => {
      it("can't be written through the vendor or admin seller routes", async () => {
        const closure = { closed_from: new Date().toISOString(), closed_to: null, closure_note: "Away" }
        const admin = await adminHeaders(getContainer(), api)

        const results = [
          await api.post(`/vendor/sellers/${gadgetsId}`, closure, gadgets).catch((e) => e.response),
          await api.post("/vendor/sellers/me", { closure_note: "Away" }, gadgets).catch((e) => e.response),
          await api.post(`/admin/sellers/${gadgetsId}`, closure, admin).catch((e) => e.response),
        ]

        expect(results.map((r) => r.status)).toEqual([400, 400, 400])
        expect(results[0].data.message).toMatch(/Shop closures are set with the shop's hours/)
        const { data } = await buyer.query().graph({
          entity: "seller",
          fields: ["closed_from", "closure_note"],
          filters: { id: gadgetsId },
        })
        expect(data[0]).toEqual({ closed_from: null, closure_note: null })
        // The shop's other details still save.
        expect(await status(api.post(`/vendor/sellers/${gadgetsId}`, { description: "Chargers and power banks" }, gadgets))).toBe(200)
      })
    })
  },
})
