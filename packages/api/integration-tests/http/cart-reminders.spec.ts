import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { remindIdleCarts } from "../../src/lib/cart-reminders"
import { pauseShop, resumeShop } from "../../src/lib/shop-hours"
import { seedDemoWorld } from "../../src/scripts/seed"
import { updateOfferWorkflow } from "../../src/workflows/offer-prices/update-offer"
import { ADDRESS, buyerCheckout, eventually, GADGETS, GROCERY, LANTERN, RETURN_URL, RICE, type Shop } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakeExpoPush, pushToken } from "../helpers/expo-push"
import { fakePaystack } from "../helpers/paystack"
import { fakeResend, type SentEmail } from "../helpers/resend"
import { fakeShipbubble } from "../helpers/shipbubble"
import { keepShopsOpen } from "../helpers/shop-hours"
import { formatMoney } from "@oja/domain"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so each fake can be named in the config before it is listening.
const paystack = fakePaystack(18000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(19000 + (process.pid % 1000))
const expo = fakeExpoPush(20000 + (process.pid % 1000))
const resend = fakeResend(29000 + (process.pid % 1000))
const BACKEND_URL = "https://api.oja.test"
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
process.env.UNSUBSCRIBE_SECRET = "cart-reminders-spec-unsubscribe-secret"
process.env.MERCUR_BACKEND_URL = BACKEND_URL

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

/** The hour of the day in Lagos at an instant. */
const lagosHour = (at: number) =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "numeric", hourCycle: "h23" }).format(at))
/** The first instant from `from`, a few minutes past an hour, whose Lagos hour passes `ok`. */
const nextLagosHour = (from: number, ok: (hour: number) => boolean) => {
  let at = Math.ceil(from / HOUR) * HOUR + 5 * MINUTE
  while (!ok(lagosHour(at))) at += HOUR
  return new Date(at)
}
/** When the job, run hourly, first finds a cart whose items last changed at `changedAt` due: 4 hours on, between 9am and 8pm Lagos time. */
const dueAt = (changedAt: number, delay = 4 * HOUR) => nextLagosHour(changedAt + delay, (h) => h >= 9 && h < 20)

// The cart reminder push (#137): a signed-in buyer's cart left unpaid and unchanged for four
// hours is pushed to each of their devices once, between 9am and 8pm Lagos time, naming its shops
// and top items, and opening the Cart tab. The same reminder goes by email (#139), with the
// current total and a signed link that unsubscribes the buyer from it. The job's function is
// called at set times.
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const ada = buyerCheckout({ api, getContainer, clerk, paystack })
    /** Every cart a test made, emptied after it so it doesn't fall due in a later test. */
    const carts: string[] = []
    let buyers = 0

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start(), expo.start(), resend.start()])
      await seedDemoWorld({ container: getContainer(), args: [] } as any)
      await keepShopsOpen(getContainer(), [GADGETS, GROCERY])
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop(), expo.stop(), resend.stop()]))
    beforeEach(async () => {
      expo.reset()
      resend.reset()
      await ada.load()
    })
    afterEach(async () => {
      const cartModule = getContainer().resolve(Modules.CART)
      const items = await cartModule.listLineItems({ cart_id: carts.splice(0) })
      if (items.length) await cartModule.softDeleteLineItems(items.map((i) => i.id))
    })

    /** A new signed-in buyer, so each test's carts and devices are its own. */
    const newBuyer = () => newBuyerWithEmail().as
    /** A new signed-in buyer and their email address. */
    const newBuyerWithEmail = () => {
      const email = `buyer-${++buyers}-${process.pid}@oja.test`
      return { email, as: ada.as(email) }
    }
    type As = ReturnType<typeof newBuyer>
    /** A device registering for pushes, as the buyer app does once its buyer is signed in. */
    const register = async (as: As) => {
      const token = pushToken()
      await api.post("/store/push-tokens", { token }, as)
      return token
    }
    /** A cart with these lines, in this order; a guest's without `as`. */
    const cartOf = async (as: As | null, lines: [Shop, { title: string }, number][]) => {
      const headers = as ?? { headers: ada.headers() }
      const { data } = await api.post("/store/carts", { region_id: ada.regionId() }, headers)
      const cartId = data.cart.id as string
      carts.push(cartId)
      for (const [shop, product, quantity] of lines)
        await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await ada.offerId(shop, product.title), quantity }, headers)
      return cartId
    }
    /** Lantern first, then two bags of rice: two shops. */
    const twoShopCart = (as: As) =>
      cartOf(as, [
        [GADGETS, LANTERN, 1],
        [GROCERY, RICE, 2],
      ])
    /** When the cart's items last changed. */
    const changedAt = async (cartId: string) => {
      const { data } = await ada.query().graph({ entity: "cart", fields: ["items.created_at", "items.updated_at"], filters: { id: cartId } })
      const items = (data[0] as any).items as { created_at: string; updated_at: string }[]
      return Math.max(...items.flatMap((i) => [Date.parse(i.created_at), Date.parse(i.updated_at)]))
    }
    const remind = (at: Date) => remindIdleCarts(getContainer(), at)
    /** The pushes a device has had, once at least `count` have arrived. */
    const pushesTo = (token: string, count = 1) => eventually(async () => expo.sentTo(token), (sent) => sent.length >= count)
    /** Waits long enough for a push that would have been sent, then says what arrived. */
    const settled = async (read: () => unknown[]) => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      return read()
    }
    const settledPushesTo = (token: string) => settled(() => expo.sentTo(token))
    /** The emails an address has had, once at least `count` have arrived. */
    const emailsTo = (address: string, count = 1) => eventually(async () => resend.sentTo(address), (sent) => sent.length >= count)
    const settledEmailsTo = (address: string) => settled(() => resend.sentTo(address))
    /** Sets an offer's price; returns how to put it back. */
    const setPrice = async (shop: Shop, product: { title: string; price: number }, amount: number) => {
      const offerId = await ada.offerId(shop, product.title)
      const run = (price: number) =>
        updateOfferWorkflow(getContainer()).run({ input: { offer: { id: offerId, prices: [{ amount: price, currency_code: "ngn" }] } } })
      await run(amount)
      return () => run(product.price)
    }

    describe("an idle cart", () => {
      it("is pushed once to each of the buyer's devices once its items have been left for four hours, opening the Cart tab", async () => {
        const buyer = newBuyer()
        const [phone, tablet] = [await register(buyer), await register(buyer)]
        const cartId = await twoShopCart(buyer)
        const changed = await changedAt(cartId)

        await remind(new Date(changed + 4 * HOUR - MINUTE))
        expect(await settledPushesTo(phone)).toEqual([])

        await remind(dueAt(changed))
        const push = {
          title: `Your items from ${GADGETS.name} and 1 more shop`,
          body: `${LANTERN.title} and ${RICE.title} are still in your cart.`,
          data: { url: "/cart", cart_id: cartId },
        }
        expect(await pushesTo(phone)).toEqual([expect.objectContaining(push)])
        expect(await pushesTo(tablet)).toEqual([expect.objectContaining(push)])
      })

      it("isn't pushed again when the job runs again, until its items change and are left again", async () => {
        const buyer = newBuyer()
        const phone = await register(buyer)
        const cartId = await twoShopCart(buyer)
        const due = dueAt(await changedAt(cartId))
        await remind(due)
        await pushesTo(phone)

        await remind(due)
        await remind(new Date(due.getTime() + HOUR))
        await remind(new Date(due.getTime() + 2 * 24 * HOUR))
        expect(await settledPushesTo(phone)).toHaveLength(1)

        const { data } = await api.get(`/store/carts/${cartId}`, buyer)
        const rice = data.cart.items.find((i: any) => i.product_title === RICE.title)
        await api.post(`/store/carts/${cartId}/line-items/${rice.id}`, { quantity: 3 }, buyer)
        const changedAgain = await changedAt(cartId)
        await remind(new Date(changedAgain + 4 * HOUR - MINUTE))
        expect(await settledPushesTo(phone)).toHaveLength(1)

        await remind(dueAt(changedAgain))
        const [, again] = await pushesTo(phone, 2)
        expect(again).toMatchObject({ title: `Your items from ${GADGETS.name} and 1 more shop`, data: { url: "/cart" } })
      })

      it("left at 11pm Lagos time is pushed the next morning, not overnight", async () => {
        const buyer = newBuyer()
        const phone = await register(buyer)
        const cartId = await cartOf(buyer, [[GROCERY, RICE, 1]])
        const changed = await changedAt(cartId)
        const elevenPm = nextLagosHour(changed + 4 * HOUR, (h) => h === 23)

        for (const hour of [0, 3, 7, 9]) await remind(new Date(elevenPm.getTime() + hour * HOUR))
        expect(await settledPushesTo(phone)).toEqual([])

        await remind(new Date(elevenPm.getTime() + 10 * HOUR))
        expect(await pushesTo(phone)).toEqual([expect.objectContaining({ title: `Your items from ${GROCERY.name}` })])
      })

      it("waits for the delay and sends in the hours set in config", async () => {
        const buyer = newBuyer()
        const phone = await register(buyer)
        const cartId = await cartOf(buyer, [[GROCERY, RICE, 1]])
        const changed = await changedAt(cartId)
        const env = { ...process.env }
        Object.assign(process.env, { CART_REMINDER_DELAY_HOURS: "1", CART_REMINDER_SEND_FROM_HOUR: "0", CART_REMINDER_SEND_UNTIL_HOUR: "24" })
        try {
          await remind(new Date(changed + HOUR - MINUTE))
          expect(await settledPushesTo(phone)).toEqual([])

          // Any hour of the day, 11pm included.
          await remind(nextLagosHour(changed + HOUR, (h) => h === 23))
          expect(await pushesTo(phone)).toHaveLength(1)
        } finally {
          for (const key of ["CART_REMINDER_DELAY_HOURS", "CART_REMINDER_SEND_FROM_HOUR", "CART_REMINDER_SEND_UNTIL_HOUR"]) {
            if (env[key] === undefined) delete process.env[key]
            else process.env[key] = env[key]
          }
        }
      })

      it("left at checkout without paying is pushed like any idle cart, and a delivery address doesn't count as changing it", async () => {
        const buyer = newBuyer()
        const phone = await register(buyer)
        const cartId = await twoShopCart(buyer)
        const changed = await changedAt(cartId)
        await api.post(`/store/carts/${cartId}/checkout`, { shipping_address: ADDRESS }, buyer)
        await api.post(`/store/carts/${cartId}/checkout/payment`, { return_url: RETURN_URL }, buyer)

        const due = dueAt(changed)
        await remind(due)
        expect(await pushesTo(phone)).toEqual([expect.objectContaining({ data: { url: "/cart", cart_id: cartId } })])

        await api.post(`/store/carts/${cartId}/checkout`, { shipping_address: { ...ADDRESS, address_2: "Flat 4" } }, buyer)
        await remind(new Date(due.getTime() + 24 * HOUR))
        expect(await settledPushesTo(phone)).toHaveLength(1)
      })

      it("isn't sent again when checkout reprices its lines, which the buyer didn't change", async () => {
        const { email, as: buyer } = newBuyerWithEmail()
        const phone = await register(buyer)
        const cartId = await twoShopCart(buyer)
        await remind(dueAt(await changedAt(cartId)))
        await pushesTo(phone)
        await emailsTo(email)

        const restore = await setPrice(GADGETS, LANTERN, LANTERN.price + 500)
        try {
          // Checkout puts the lantern's line at its new price.
          await api.post(`/store/carts/${cartId}/checkout`, { shipping_address: ADDRESS }, buyer)
          await remind(dueAt(await changedAt(cartId)))

          expect(await settledPushesTo(phone)).toHaveLength(1)
          expect(await settledEmailsTo(email)).toHaveLength(1)
        } finally {
          await restore()
        }
      })
    })

    describe("no push", () => {
      it("for a guest's cart", async () => {
        const cartId = await cartOf(null, [[GROCERY, RICE, 1]])

        await remind(dueAt(await changedAt(cartId)))

        expect(await settled(() => expo.messages())).toEqual([])
      })

      it("for a guest's cart with an email, whose guest customer has no account", async () => {
        const email = `guest-${process.pid}@oja.test`
        const cartId = await cartOf(null, [[GROCERY, RICE, 1]])
        await api.post(`/store/carts/${cartId}`, { email }, { headers: ada.headers() })
        const { data } = await ada.query().graph({ entity: "cart", fields: ["customer.has_account"], filters: { id: cartId } })
        expect((data[0] as any).customer).toEqual(expect.objectContaining({ has_account: false }))

        await remind(dueAt(await changedAt(cartId)))

        expect(await settledEmailsTo(email)).toEqual([])
        expect(expo.messages()).toEqual([])
      })

      it("for a paid cart", async () => {
        const phone = await register(ada.ada())
        const { cartId } = await ada.paidCheckout()
        carts.push(cartId)
        // Ada's phone is told her order is confirmed.
        await pushesTo(phone)

        await remind(dueAt(await changedAt(cartId)))

        expect(await settledPushesTo(phone)).toHaveLength(1)
      })

      it("for a buyer who turned cart reminder pushes off, whose order pushes still arrive", async () => {
        const preferences = "/store/customers/me/notification-preferences"
        await api.post(preferences, { cart_reminder_push: false }, ada.ada())
        try {
          const phone = await register(ada.ada())
          const { cartId: paidCartId } = await ada.paidCheckout()
          carts.push(paidCartId)
          // Ada's phone is still told her order is confirmed.
          expect(await pushesTo(phone)).toEqual([expect.objectContaining({ title: expect.stringMatching(/confirmed$/) })])

          const cartId = await twoShopCart(ada.ada())
          await remind(dueAt(await changedAt(cartId)))

          expect(await settledPushesTo(phone)).toHaveLength(1)
        } finally {
          await api.post(preferences, { cart_reminder_push: true }, ada.ada())
        }
      })

      it("for a cart with nothing that can be bought now", async () => {
        const buyer = newBuyer()
        const phone = await register(buyer)
        const cartId = await twoShopCart(buyer)
        const due = dueAt(await changedAt(cartId))
        const restock = await ada.setStock(GROCERY, RICE.title, 0)
        const gadgets = await ada.sellerId(GADGETS)
        await pauseShop(getContainer(), gadgets, { note: "Stocktake" })
        try {
          await remind(due)
          expect(await settledPushesTo(phone)).toEqual([])
        } finally {
          await resumeShop(getContainer(), gadgets)
          await restock()
        }
      })
    })

    describe("what it says", () => {
      it("leaves out a sold-out line and its shop", async () => {
        const buyer = newBuyer()
        const phone = await register(buyer)
        const cartId = await twoShopCart(buyer)
        const restock = await ada.setStock(GADGETS, LANTERN.title, 0)
        try {
          await remind(dueAt(await changedAt(cartId)))
          expect(await pushesTo(phone)).toEqual([
            expect.objectContaining({ title: `Your items from ${GROCERY.name}`, body: `${RICE.title} is still in your cart.` }),
          ])
        } finally {
          await restock()
        }
      })

      it("calls out a price that dropped since it was added", async () => {
        const buyer = newBuyer()
        const phone = await register(buyer)
        const cartId = await twoShopCart(buyer)
        const restore = await setPrice(GADGETS, LANTERN, LANTERN.price - 1000)
        try {
          await remind(dueAt(await changedAt(cartId)))
          const [push] = await pushesTo(phone)
          const money = (amount: number) => formatMoney(amount, "ngn")
          expect(push.body).toBe(
            `${LANTERN.title} and ${RICE.title} are still in your cart. ${LANTERN.title} is now ${money(LANTERN.price - 1000)}, down from ${money(LANTERN.price)}.`
          )
        } finally {
          await restore()
        }
      })

      it("calls out an item with only a few left", async () => {
        const buyer = newBuyer()
        const phone = await register(buyer)
        const cartId = await twoShopCart(buyer)
        const restock = await ada.setStock(GROCERY, RICE.title, 3)
        try {
          await remind(dueAt(await changedAt(cartId)))
          const [push] = await pushesTo(phone)
          expect(push.body).toBe(`${LANTERN.title} and ${RICE.title} are still in your cart. Only 3 left of ${RICE.title}.`)
        } finally {
          await restock()
        }
      })
    })

    describe("the reminder email", () => {
      const money = (amount: number) => formatMoney(amount, "ngn")
      const PREFERENCES = "/store/customers/me/notification-preferences"
      const preferencesOf = async (as: As) => (await api.get(PREFERENCES, as)).data.notification_preferences
      /** The unsubscribe link an email carries in its List-Unsubscribe header. */
      const unsubscribeLinkOf = (email: SentEmail) => {
        const link = /^<(.+)>$/.exec(email.headers?.["List-Unsubscribe"] ?? "")?.[1]
        if (!link) throw new Error(`no unsubscribe link in ${JSON.stringify(email.headers)}`)
        return link
      }
      /** The backend path of a link, for the test client. */
      const pathOf = (link: string) => {
        expect(link.startsWith(`${BACKEND_URL}/`)).toBe(true)
        return link.slice(BACKEND_URL.length)
      }
      const tokenOf = (email: SentEmail) => pathOf(unsubscribeLinkOf(email)).slice("/unsubscribe/".length)
      const anyStatus = { validateStatus: () => true }
      /** The one-click unsubscribe POST mail apps send (RFC 8058). */
      const oneClick = (path: string) =>
        api.post(path, "List-Unsubscribe=One-Click", { headers: { "content-type": "application/x-www-form-urlencoded" }, ...anyStatus })
      /** A new buyer with a due two-shop cart, reminded once by email. */
      const remindedByEmail = async () => {
        const { email, as } = newBuyerWithEmail()
        const cartId = await twoShopCart(as)
        await remind(dueAt(await changedAt(cartId)))
        const [sent] = await emailsTo(email)
        return { email, as, sent }
      }

      it("goes to the buyer once alongside the push, with the push's content, the current total and a button to the cart", async () => {
        const { email, as } = newBuyerWithEmail()
        const phone = await register(as)
        const cartId = await twoShopCart(as)
        const due = dueAt(await changedAt(cartId))
        await remind(due)

        const [sent] = await emailsTo(email)
        expect(sent.subject).toBe(`Your items from ${GADGETS.name} and 1 more shop`)
        expect(sent.text).toContain(`${LANTERN.title} and ${RICE.title} are still in your cart.`)
        for (const text of [GADGETS.name, GROCERY.name, LANTERN.title, RICE.title, money(LANTERN.price + 2 * RICE.price)])
          expect(sent.text).toContain(text)
        expect(sent.html).toContain('href="oja://cart"')
        expect(await pushesTo(phone)).toHaveLength(1)

        await remind(due)
        await remind(new Date(due.getTime() + HOUR))
        expect(await settledEmailsTo(email)).toHaveLength(1)
      })

      it("carries the good news the push does, and no discount", async () => {
        const { email, as } = newBuyerWithEmail()
        const cartId = await twoShopCart(as)
        const restore = await setPrice(GADGETS, LANTERN, LANTERN.price - 1000)
        try {
          await remind(dueAt(await changedAt(cartId)))
          const [sent] = await emailsTo(email)
          expect(sent.text).toContain(`${LANTERN.title} is now ${money(LANTERN.price - 1000)}, down from ${money(LANTERN.price)}.`)
          expect(sent.text).toContain(money(LANTERN.price - 1000 + 2 * RICE.price))
          expect(sent.text?.toLowerCase()).not.toMatch(/discount|coupon|promo code/)
        } finally {
          await restore()
        }
      })

      it("carries List-Unsubscribe and List-Unsubscribe-Post headers, and its link in the email too", async () => {
        const { sent } = await remindedByEmail()

        expect(sent.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click")
        const link = unsubscribeLinkOf(sent)
        expect(link.startsWith(`${BACKEND_URL}/unsubscribe/`)).toBe(true)
        expect(sent.html).toContain(link)
      })

      it("isn't sent with the email switch off, while the push still follows its own switch", async () => {
        const { email, as } = newBuyerWithEmail()
        const phone = await register(as)
        await api.post(PREFERENCES, { cart_reminder_email: false }, as)
        const cartId = await twoShopCart(as)

        await remind(dueAt(await changedAt(cartId)))

        expect(await pushesTo(phone)).toHaveLength(1)
        expect(await settledEmailsTo(email)).toEqual([])
      })

      it("unsubscribes the buyer from its link without signing in, which the preferences then show", async () => {
        const { email, as, sent } = await remindedByEmail()

        const res = await api.get(pathOf(unsubscribeLinkOf(sent)), anyStatus)

        expect(res.status).toBe(200)
        expect(res.headers["content-type"]).toMatch(/html/)
        expect(res.data).toContain("You're unsubscribed")
        expect(await preferencesOf(as)).toEqual({ cart_reminder_push: true, cart_reminder_email: false })

        const cartId = await cartOf(as, [[GROCERY, RICE, 1]])
        await remind(dueAt(await changedAt(cartId)))
        expect(await settledEmailsTo(email)).toHaveLength(1)
      })

      it("unsubscribes the buyer with the one-click POST", async () => {
        const { as, sent } = await remindedByEmail()

        const res = await oneClick(pathOf(unsubscribeLinkOf(sent)))

        expect(res.status).toBe(200)
        expect(await preferencesOf(as)).toEqual({ cart_reminder_push: true, cart_reminder_email: false })
      })

      it("refuses a tampered or unknown unsubscribe link, leaving the buyer subscribed", async () => {
        const ada = await remindedByEmail()
        const bea = await remindedByEmail()
        const [token, beasToken] = [tokenOf(ada.sent), tokenOf(bea.sent)]
        const signatureAt = (t: string) => t.lastIndexOf(".")
        const refused = [
          // Its signature changed.
          `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`,
          // Another buyer's signature on Ada's link.
          `${token.slice(0, signatureAt(token))}${beasToken.slice(signatureAt(beasToken))}`,
          // Ada's email link turned to another channel.
          token.replace(/^[^.]+/, "cart_reminder_push"),
          // Made up.
          "cart_reminder_email.cus_01JUNKNOWN0000000000000000.bm90LWEtc2lnbmF0dXJl",
          "nonsense",
        ]

        for (const bad of refused) {
          const get = await api.get(`/unsubscribe/${bad}`, anyStatus)
          expect(get.status).toBe(404)
          expect(get.data).not.toContain("You're unsubscribed")
          expect((await oneClick(`/unsubscribe/${bad}`)).status).toBe(404)
        }
        expect(await preferencesOf(ada.as)).toEqual({ cart_reminder_push: true, cart_reminder_email: true })
        expect(await preferencesOf(bea.as)).toEqual({ cart_reminder_push: true, cart_reminder_email: true })
      })
    })
  },
})
