import { canReview } from "@oja/domain"
import { demoTimes, receivedFulfilment, reviewsOn, shopPrice } from "../scripts/demo-reviews"
import {
  DEMO_BUYER_EMAIL,
  SEED_PRODUCTS,
  SEED_REVIEWED_ORDERS,
  SEED_REVIEWERS,
  SEED_SELLERS,
  SEED_SIZES,
  type SeedReview,
} from "../scripts/seed-data"

const product = (title: string) => SEED_PRODUCTS.find((p) => p.title === title)!
const allReviews = SEED_REVIEWED_ORDERS.flatMap((order) => reviewsOn(order).map((named) => ({ order, ...named })))

describe("demo reviews", () => {
  it("are of orders a buyer could have placed: a seeded shop's products, at its price, sized where they come in sizes", () => {
    const buyers = new Set([...SEED_REVIEWERS.map((r) => r.email), DEMO_BUYER_EMAIL])
    for (const order of SEED_REVIEWED_ORDERS) {
      const shop = SEED_SELLERS.find((s) => s.name === order.shop)
      expect([order.shop, !!shop]).toEqual([order.shop, true])
      expect(buyers.has(order.buyer)).toBe(true)
      // In-store pickup only where the shop has a counter (#12).
      if (order.method === "pickup") expect(shop!.collection_point).toBeDefined()
      expect(order.days_ago).toBeGreaterThan(0)
      for (const line of order.lines) {
        expect([line.product, shopPrice(product(line.product), order.shop)]).toEqual([line.product, expect.any(Number)])
        expect(product(line.product).sized ? SEED_SIZES.includes(line.size!) : line.size === undefined).toBe(true)
      }
    }
  })

  it("review each shop and product once per buyer, and every one on each buyer's orders, so none waits to be reviewed", () => {
    const written = new Map<string, Set<string>>()
    for (const order of SEED_REVIEWED_ORDERS) {
      const mine = written.get(order.buyer) ?? new Set<string>()
      written.set(order.buyer, mine)
      for (const named of reviewsOn(order)) {
        const key = named.reference === "seller" ? `shop:${named.shop}` : `product:${named.product}`
        expect([order.buyer, key, mine.has(key)]).toEqual([order.buyer, key, false])
        mine.add(key)
      }
      // Reviewed on this order or an earlier one.
      for (const key of [`shop:${order.shop}`, ...order.lines.map((l) => `product:${l.product}`)]) {
        expect([order.buyer, key, mine.has(key)]).toEqual([order.buyer, key, true])
      }
    }
  })

  it("rate 1 to 5, mostly 4 or 5, and have a shop's reply only once published", () => {
    const reviews: SeedReview[] = allReviews.map((r) => r.review)
    for (const review of reviews) {
      expect(review.rating).toBeGreaterThanOrEqual(1)
      expect(review.rating).toBeLessThanOrEqual(5)
      if (review.reply) expect(review.status).toBe("published")
      // Mercur keeps a note to 300 characters.
      expect((review.text ?? "").length).toBeLessThanOrEqual(300)
    }
    expect(reviews.filter((r) => r.rating >= 4).length / reviews.length).toBeGreaterThan(0.6)
    expect(reviews.some((r) => !r.text)).toBe(true)
    expect(reviews.some((r) => r.reply)).toBe(true)
  })

  it("give the demo buyer reviews of shops and products in every moderation state, for My reviews", () => {
    const mine = allReviews.filter((r) => r.order.buyer === DEMO_BUYER_EMAIL)
    expect(new Set(mine.map((r) => r.reference))).toEqual(new Set(["seller", "product"]))
    expect(new Set(mine.map((r) => r.review.status))).toEqual(new Set(["published", "pending", "rejected"]))
    expect(new Set(mine.map((r) => r.order.shop)).size).toBe(SEED_SELLERS.length)
  })

  it("prices a product at its department's shop, or where it's also sold", () => {
    expect(shopPrice(product("Plantain Chips 150g"), "Iya Bisi Foodstuff")).toBe(1200)
    expect(shopPrice(product("Plantain Chips 150g"), "Ikeja Gadget Hub")).toBe(1300)
    expect(shopPrice(product("Plantain Chips 150g"), "Adire House")).toBeUndefined()
  })

  it("dates an order placed the day before it was received, and reviewed that evening, all in the past", () => {
    const now = new Date("2026-10-23T09:00:00Z")
    const { placedAt, receivedAt, reviewedAt } = demoTimes(1, now)

    expect(receivedAt.toISOString()).toBe("2026-10-22T13:00:00.000Z")
    expect(placedAt.getTime()).toBeLessThan(receivedAt.getTime())
    expect(reviewedAt.getTime()).toBeGreaterThan(receivedAt.getTime())
    expect(reviewedAt.getTime()).toBeLessThan(now.getTime())
  })

  it("takes a delivery order to Delivered through the courier's handover, and a pickup order to Collected", () => {
    const times = { placedAt: new Date("2026-10-01T11:00:00Z"), receivedAt: new Date("2026-10-02T13:00:00Z"), staff: "mem_1" }

    const delivered = receivedFulfilment("delivery", { ...times, collectedBy: "Tunde Bakare" })
    const collected = receivedFulfilment("pickup", { ...times, collectedBy: "Funmi Alabi" })

    expect(delivered.fulfilment).toMatchObject({ method: "delivery", state: "delivered", handover: { staff: { actor: "mem_1" } } })
    expect(collected.fulfilment).toMatchObject({
      method: "pickup",
      state: "collected",
      collection: { actor: "mem_1", collectedBy: "Funmi Alabi", at: "2026-10-02T13:00:00.000Z" },
    })
    for (const { fulfilment, reached } of [delivered, collected]) {
      expect(canReview(fulfilment.state)).toBe(true)
      expect(reached.new).toBe("2026-10-01T11:00:00.000Z")
      expect(reached[fulfilment.state]).toBe("2026-10-02T13:00:00.000Z")
      const stamps = Object.values(reached).map((at) => Date.parse(at!))
      expect(stamps).toEqual([...stamps].sort((a, b) => a - b))
    }
    expect(Object.keys(delivered.reached)).toEqual([
      "new",
      "accepted",
      "picking",
      "packed",
      "label_booked",
      "courier_confirmed",
      "handed_to_courier",
      "delivered",
    ])
  })
})
