import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { deleteOffersWorkflow } from "@mercurjs/core/workflows"
import { MercurModules } from "@mercurjs/types"
import { checkCartLines } from "../../src/lib/cart-line-check"
import { pauseShop, resumeShop } from "../../src/lib/shop-hours"
import { updateOfferWorkflow } from "../../src/workflows/offer-prices/update-offer"
import { seedDemoWorld } from "../../src/scripts/seed"
import { buyerCheckout, GADGETS, GROCERY, LANTERN, RICE } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakePaystack } from "../helpers/paystack"
import { fakeShipbubble } from "../helpers/shipbubble"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so each fake can be named in the config before it is listening.
const paystack = fakePaystack(27000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(28000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers each provider only when its key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl

// Where each cart line stands (#135): the price it was added at, its offer's price now, how many
// are left, and whether its shop takes orders now. Checkout reprices and cuts to stock from it;
// the cart reminder asks it what the cart can still be bought for. It changes nothing.
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start()])
      await seedDemoWorld({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop()]))
    beforeEach(() => buyer.load())

    /** Sets an offer's price; returns how to put it back. */
    const setPrice = async (offerId: string, amount: number, was: number) => {
      const run = (price: number) =>
        updateOfferWorkflow(getContainer()).run({ input: { offer: { id: offerId, prices: [{ amount: price, currency_code: "ngn" }] } } })
      await run(amount)
      return () => run(was)
    }
    const lineOf = (check: Awaited<ReturnType<typeof checkCartLines>>, title: string) =>
      check.lines.find((l) => l.product_title === title)!

    it("gives a line whose price dropped the price it was added at and its offer's price now", async () => {
      const cartId = await buyer.adasCart()
      const restore = await setPrice(await buyer.offerId(GADGETS, LANTERN.title), LANTERN.price - 1000, LANTERN.price)
      try {
        const check = await checkCartLines(getContainer(), cartId)

        expect(lineOf(check, LANTERN.title)).toMatchObject({
          quantity: 1,
          seller: { name: GADGETS.name },
          added_at: { unit_price: LANTERN.price },
          now: { unit_price: LANTERN.price - 1000 },
          not_taking_orders: null,
        })
        expect(lineOf(check, RICE.title)).toMatchObject({
          quantity: 2,
          seller: { name: GROCERY.name },
          added_at: { unit_price: RICE.price },
          now: { unit_price: RICE.price },
        })
      } finally {
        await restore()
      }
    })

    it("gives a line whose price rose the price it was added at and its offer's price now", async () => {
      const cartId = await buyer.adasCart()
      const restore = await setPrice(await buyer.offerId(GROCERY, RICE.title), RICE.price + 500, RICE.price)
      try {
        const check = await checkCartLines(getContainer(), cartId)

        expect(lineOf(check, RICE.title)).toMatchObject({
          added_at: { unit_price: RICE.price, compare_at_unit_price: null },
          now: { unit_price: RICE.price + 500, compare_at_unit_price: null },
        })
      } finally {
        await restore()
      }
    })

    it("says a sold-out line has none left", async () => {
      const cartId = await buyer.adasCart()
      const restore = await buyer.setStock(GROCERY, RICE.title, 0)
      try {
        const check = await checkCartLines(getContainer(), cartId)

        expect(lineOf(check, RICE.title)).toMatchObject({ quantity: 2, available_quantity: 0, not_taking_orders: null })
      } finally {
        await restore()
      }
    })

    it("says how many are left of a line wanting more than is left", async () => {
      const cartId = await buyer.adasCart()
      const restore = await buyer.setStock(GROCERY, RICE.title, 1)
      try {
        const check = await checkCartLines(getContainer(), cartId)

        expect(lineOf(check, RICE.title)).toMatchObject({ quantity: 2, available_quantity: 1 })
      } finally {
        await restore()
      }
    })

    it("says a paused shop isn't taking orders, still with its offer's price now", async () => {
      const cartId = await buyer.adasCart()
      const grocery = await buyer.sellerId(GROCERY)
      await pauseShop(getContainer(), grocery, { note: "Restocking" })
      try {
        const check = await checkCartLines(getContainer(), cartId)

        expect(lineOf(check, RICE.title)).toMatchObject({
          not_taking_orders: "paused",
          shop_status: { state: "closed_until", reason: "pause", note: "Restocking", orderable: false },
          now: { unit_price: RICE.price },
        })
        expect(lineOf(check, LANTERN.title).not_taking_orders).toBeNull()
      } finally {
        await resumeShop(getContainer(), grocery)
      }
    })

    it("says a shop that has left Oja isn't taking orders, with no price now", async () => {
      const cartId = await buyer.adasCart()
      const sellers = getContainer().resolve(MercurModules.SELLER) as any
      const grocery = await buyer.sellerId(GROCERY)
      await sellers.updateSellers({ id: grocery, status: "suspended" })
      try {
        const check = await checkCartLines(getContainer(), cartId)

        expect(lineOf(check, RICE.title)).toMatchObject({
          seller: { name: GROCERY.name },
          not_taking_orders: "left",
          shop_status: null,
          now: null,
          added_at: { unit_price: RICE.price },
        })
      } finally {
        await sellers.updateSellers({ id: grocery, status: "open" })
      }
    })

    it("leaves the cart as it was", async () => {
      const cartId = await buyer.adasCart()
      const cartNow = async () => (await api.get(`/store/carts/${cartId}`, buyer.ada())).data.cart
      const restorePrice = await setPrice(await buyer.offerId(GADGETS, LANTERN.title), LANTERN.price - 1000, LANTERN.price)
      const restoreStock = await buyer.setStock(GROCERY, RICE.title, 1)
      try {
        const before = await cartNow()

        await checkCartLines(getContainer(), cartId)

        const after = await cartNow()
        expect(after.updated_at).toBe(before.updated_at)
        expect(after.items.map((i: any) => [i.id, i.quantity, i.unit_price])).toEqual(
          before.items.map((i: any) => [i.id, i.quantity, i.unit_price])
        )
        expect(after.total).toBe(before.total)
      } finally {
        await restoreStock()
        await restorePrice()
      }
    })

    // Last: the grocery's rice offer stays deleted.
    it("says a line whose offer is gone has no shop and no price now", async () => {
      const cartId = await buyer.adasCart()
      await deleteOffersWorkflow(getContainer()).run({ input: { ids: [await buyer.offerId(GROCERY, RICE.title)] } })

      const check = await checkCartLines(getContainer(), cartId)

      expect(lineOf(check, RICE.title)).toMatchObject({ seller: null, not_taking_orders: "left", now: null, shop_status: null })
    })
  },
})
