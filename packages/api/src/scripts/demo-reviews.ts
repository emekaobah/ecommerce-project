import type { ExecArgs, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, toHandle } from "@medusajs/framework/utils"
import { createCustomersWorkflow, createOrderWorkflow } from "@medusajs/medusa/core-flows"
import { respondReviewWorkflow, updateReviewWorkflow } from "@mercurjs/core/workflows"
import { MercurModules } from "@mercurjs/types"
import {
  newFulfilment,
  orderPhase,
  recordReached,
  transition,
  type Fulfilment,
  type FulfilmentMethod,
  type FulfilmentTrigger,
  type Reached,
  type ReviewSubject,
} from "@oja/domain"
import { fulfilmentService } from "../lib/order-fulfilment"
import { buyerReviews, subjectKey } from "../lib/reviews"
import { submitReviewWorkflow } from "../workflows/review/submit-review"
import {
  DEMO_BUYER,
  DEMO_BUYER_EMAIL,
  SEED_PRODUCTS,
  SEED_REVIEWED_ORDERS,
  SEED_REVIEWERS,
  SEED_SELLERS,
  type SeedProduct,
  type SeedReview,
  type SeedReviewedOrder,
  type SeedReviewer,
} from "./seed-data"

/**
 * Puts the demo buyers' reviews of the seeded shops and products on the database (#7), each on
 * an order the buyer received, as the API requires. The seed runs it on fresh databases; on
 * existing ones:
 *
 *   bun run --cwd packages/api demo:reviews
 *
 * A review a buyer already wrote is never written again (a buyer has one review of each shop and
 * product), so re-running adds nothing. The demo buyer's reviews (`DEMO_BUYER_EMAIL`, for My
 * reviews) wait until that buyer has signed in to the app once. Each review is written through
 * the buyer's own review workflow, so its order must be one they received: the reviews bring
 * their demo orders (and reviewers), and touch no other order, price or stock.
 */
export default async function applyDemoReviewsScript({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const tally = await applyDemoReviews(container)
  logger.info(
    `Demo reviews: ${tally.reviews} reviews on ${tally.orders} new orders, ${tally.current} orders' reviews already there.`
  )
  if (tally.waiting) {
    logger.info(`${tally.waiting} orders wait for ${DEMO_BUYER_EMAIL} to sign in to the buyer app; run this again after.`)
  }
  if (tally.missing.length) logger.warn(`Not in this database, so skipped: ${tally.missing.join(", ")}. Run the seed first.`)
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * When a demo order was placed and received, and when its buyer reviewed it: received early
 * afternoon in Lagos `days_ago` days before `now`, placed the day before, reviewed that evening.
 */
export function demoTimes(daysAgo: number, now: Date): { placedAt: Date; receivedAt: Date; reviewedAt: Date } {
  const receivedAt = new Date(now.getTime() - daysAgo * DAY)
  receivedAt.setUTCHours(13, 0, 0, 0)
  return { placedAt: new Date(receivedAt.getTime() - 26 * HOUR), receivedAt, reviewedAt: new Date(receivedAt.getTime() + 5 * HOUR) }
}

/** The shop's price for a seeded product: its department's shop's, or the one it lists in `also_at`. */
export function shopPrice(product: SeedProduct, shopName: string): number | undefined {
  const department = SEED_SELLERS.find((s) => s.name === shopName)?.department
  if (product.department === department) return product.price
  return product.also_at?.find((a) => a.shop === shopName)?.price
}

/**
 * A received order's fulfilment, as the shop's staff and the courier would have taken it there
 * from New: accepted, picked and packed within the hour, then delivered by the courier (handed
 * over that afternoon) or collected at the counter at `receivedAt`. Built by the fulfilment
 * state machine itself, so it is a valid record, with when it reached each state.
 */
export function receivedFulfilment(
  method: FulfilmentMethod,
  { placedAt, receivedAt, staff, collectedBy }: { placedAt: Date; receivedAt: Date; staff: string; collectedBy: string }
): { fulfilment: Fulfilment; reached: Reached } {
  const after = (minutes: number) => new Date(placedAt.getTime() + minutes * 60 * 1000).toISOString()
  const received = receivedAt.toISOString()
  const prepared: FulfilmentTrigger[] = [
    { source: "staff", type: "accept", actor: staff, at: after(20) },
    { source: "staff", type: "start_picking", actor: staff, at: after(40) },
    { source: "staff", type: "mark_packed", actor: staff, at: after(70) },
  ]
  const handedOn: FulfilmentTrigger[] =
    method === "pickup"
      ? [{ source: "staff", type: "collect", actor: staff, at: received, collectedBy }]
      : [
          { source: "provider", type: "label_created", at: after(80) },
          { source: "provider", type: "confirmed", at: after(95) },
          { source: "staff", type: "confirm_handover", actor: staff, at: after(180) },
          { source: "provider", type: "picked_up", at: after(185) },
          { source: "provider", type: "delivered", at: received },
        ]
  return [...prepared, ...handedOn].reduce<{ fulfilment: Fulfilment; reached: Reached }>(
    ({ fulfilment, reached }, trigger) => {
      const result = transition(fulfilment, trigger)
      if (!result.ok) throw new Error(`A ${method} order can't be ${trigger.type} from ${fulfilment.state}`)
      return { fulfilment: result.fulfilment, reached: recordReached(reached, fulfilment, result.fulfilment, trigger.at) }
    },
    { fulfilment: newFulfilment(method), reached: { new: placedAt.toISOString() } }
  )
}

/** What one demo review is of, by name, as the seed data names it. */
type NamedReview = { reference: "seller"; shop: string; review: SeedReview } | { reference: "product"; product: string; review: SeedReview }

/** The reviews the buyer writes on a demo order: of its shop, then of each product, as listed. */
export function reviewsOn(order: SeedReviewedOrder): NamedReview[] {
  return [
    ...(order.shop_review ? [{ reference: "seller" as const, shop: order.shop, review: order.shop_review }] : []),
    ...order.lines.flatMap((line) => (line.review ? [{ reference: "product" as const, product: line.product, review: line.review }] : [])),
  ]
}

export type DemoReviewsTally = {
  /** Demo orders placed now, for the reviews written now. */
  orders: number
  reviews: number
  /** Demo orders whose reviews were all there already. */
  current: number
  /** Demo orders waiting for the demo buyer to sign in. */
  waiting: number
  /** Shops and products the seed data names that this database doesn't have. */
  missing: string[]
}

type ShopRow = { id: string; name: string; handle: string }
type ProductRow = { id: string; title: string; handle: string; thumbnail: string | null; variants: { id: string; title: string }[] }

/** A demo order ready to place: whose, with what, and the reviews it still needs. */
type PlannedOrder = {
  order: SeedReviewedOrder
  buyer: SeedReviewer & { id: string }
  shop: ShopRow & { staff: string }
  lines: { product: ProductRow; variant: { id: string; title: string }; quantity: number; price: number }[]
  reviews: (ReviewSubject & { review: SeedReview })[]
}

export async function applyDemoReviews(container: MedusaContainer, now = new Date()): Promise<DemoReviewsTally> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const [shops, products, buyers, { data: regions }] = await Promise.all([
    loadShops(container),
    loadProducts(container),
    loadBuyers(container),
    query.graph({ entity: "region", fields: ["id", "currency_code"] }),
  ])
  const region = regions[0] as { id: string; currency_code: string }
  const tally: DemoReviewsTally = { orders: 0, reviews: 0, current: 0, waiting: 0, missing: [] }
  const missing = new Set<string>()

  // What each buyer reviewed already, whichever order it was on.
  const reviewed = new Map(
    await Promise.all(
      [...buyers.values()].map(async (b) => [b.id, new Set((await buyerReviews(container, b.id)).keys())] as const)
    )
  )

  const planned: PlannedOrder[] = []
  for (const order of SEED_REVIEWED_ORDERS) {
    const buyer = buyers.get(order.buyer)
    if (!buyer) {
      tally.waiting++
      continue
    }
    const shop = shops.get(order.shop)
    if (!shop) missing.add(order.shop)
    const lines = order.lines.flatMap((line) => {
      const product = products.get(toHandle(line.product))
      const variant = product?.variants.find((v) => v.title === (line.size ?? line.product))
      if (!product || !variant) {
        missing.add(line.product)
        return []
      }
      const price = shopPrice(SEED_PRODUCTS.find((p) => p.title === line.product)!, order.shop)!
      return [{ product, variant, quantity: line.quantity ?? 1, price }]
    })
    if (!shop || lines.length < order.lines.length) continue

    const ofOrder = reviewsOn(order).map(({ review, ...named }) =>
      named.reference === "seller"
        ? { reference: "seller" as const, reference_id: shop.id, review }
        : { reference: "product" as const, reference_id: products.get(toHandle(named.product))!.id, review }
    )
    const wanted = ofOrder.filter((r) => !reviewed.get(buyer.id)!.has(subjectKey(r)))
    if (!wanted.length) {
      tally.current++
      continue
    }
    planned.push({ order, buyer, shop, lines, reviews: wanted })
  }
  tally.missing = [...missing]

  // One order at a time, in the data's order (each buyer's oldest first), stopping at the first
  // failure, so the tally counts only what was written.
  await planned.reduce<Promise<void>>(
    (done, plan) =>
      done
        .then(() => placeReviewedOrder(container, plan, { region, now }))
        .then(() => {
          tally.orders++
          tally.reviews += plan.reviews.length
        }),
    Promise.resolve()
  )
  return tally
}

/** The seeded shops by name, each with its staff member, who took the demo orders. */
async function loadShops(container: MedusaContainer): Promise<Map<string, ShopRow & { staff: string }>> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const [{ data: sellers }, { data: members }] = await Promise.all([
    query.graph({ entity: "seller", fields: ["id", "name", "handle"], filters: { handle: SEED_SELLERS.map((s) => toHandle(s.name)) } }),
    query.graph({ entity: "member", fields: ["id", "email"], filters: { email: SEED_SELLERS.map((s) => s.staff.email) } }),
  ])
  const memberByEmail = new Map((members as unknown as { id: string; email: string }[]).map((m) => [m.email, m.id]))
  return new Map(
    (sellers as unknown as ShopRow[]).flatMap((seller) => {
      const config = SEED_SELLERS.find((s) => toHandle(s.name) === seller.handle)!
      const staff = memberByEmail.get(config.staff.email)
      return staff ? [[config.name, { ...seller, staff }] as const] : []
    })
  )
}

async function loadProducts(container: MedusaContainer): Promise<Map<string, ProductRow>> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "thumbnail", "variants.id", "variants.title"],
    filters: { handle: SEED_PRODUCTS.map((p) => toHandle(p.title)) },
  })
  return new Map((data as unknown as ProductRow[]).map((p) => [p.handle, p]))
}

/**
 * The demo buyers by email: the reviewers, created if missing, and the demo buyer if they have
 * signed in to the app (Clerk creates their customer then).
 */
async function loadBuyers(container: MedusaContainer): Promise<Map<string, SeedReviewer & { id: string }>> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const load = async () => {
    const { data } = await query.graph({
      entity: "customer",
      fields: ["id", "email"],
      filters: { email: [...SEED_REVIEWERS.map((r) => r.email), DEMO_BUYER_EMAIL] },
    })
    return new Map((data as unknown as { id: string; email: string }[]).map((c) => [c.email, c.id]))
  }
  let ids = await load()
  const absent = SEED_REVIEWERS.filter((r) => !ids.has(r.email))
  if (absent.length) {
    await createCustomersWorkflow(container).run({
      input: { customersData: absent.map(({ email, first_name, last_name }) => ({ email, first_name, last_name })) },
    })
    ids = await load()
  }
  return new Map(
    [...SEED_REVIEWERS, DEMO_BUYER].flatMap((person) => {
      const id = ids.get(person.email)
      return id ? [[person.email, { ...person, id }] as const] : []
    })
  )
}

/**
 * Module services' generated updates write any column, `created_at` included, which their typed
 * inputs leave out: how a demo order and its reviews are dated in the past.
 */
type Backdate = { id: string; created_at: Date }

/**
 * Places the demo order as the buyer received it, then writes their reviews on it. The order is
 * the shop's, received `days_ago` days ago, and in no checkout (order group), so it stays out of
 * the buyer's order history. It took no payment, so it is never due for payout.
 */
async function placeReviewedOrder(
  container: MedusaContainer,
  { order, buyer, shop, lines, reviews }: PlannedOrder,
  { region, now }: { region: { id: string; currency_code: string }; now: Date }
) {
  const { placedAt, receivedAt, reviewedAt } = demoTimes(order.days_ago, now)
  const address = {
    first_name: buyer.first_name,
    last_name: buyer.last_name,
    ...buyer.address,
    province: "Lagos",
    country_code: "ng",
  }
  const { result: placed } = await createOrderWorkflow(container).run({
    input: {
      region_id: region.id,
      currency_code: region.currency_code,
      customer_id: buyer.id,
      email: buyer.email,
      shipping_address: address,
      billing_address: address,
      items: lines.map(({ product, variant, quantity, price }) => ({
        title: variant.title,
        product_title: product.title,
        variant_id: variant.id,
        thumbnail: product.thumbnail ?? undefined,
        quantity,
        unit_price: price,
        // Shop prices include VAT, as offer prices do.
        is_tax_inclusive: true,
      })),
    },
  })
  await Promise.all([
    container.resolve(ContainerRegistrationKeys.LINK).create({
      [Modules.ORDER]: { order_id: placed.id },
      [MercurModules.SELLER]: { seller_id: shop.id },
    }),
    container.resolve<{ updateOrders(data: Backdate[]): Promise<unknown> }>(Modules.ORDER).updateOrders([{ id: placed.id, created_at: placedAt }]),
  ])

  const { fulfilment, reached } = receivedFulfilment(order.method, {
    placedAt,
    receivedAt,
    staff: shop.staff,
    collectedBy: `${buyer.first_name} ${buyer.last_name}`,
  })
  await fulfilmentService(container).createOrderFulfilments({
    order_id: placed.id,
    customer_id: buyer.id,
    seller_id: shop.id,
    order_group_id: null,
    placed_at: placedAt,
    state: fulfilment.state,
    phase: orderPhase(fulfilment.state, []),
    fulfilment,
    reached,
  })

  // The shop's review first, a minute apart, as the review form lists them.
  await Promise.all(
    reviews.map((review, i) =>
      writeReview(container, { order_id: placed.id, customer_id: buyer.id, ...review }, new Date(reviewedAt.getTime() + i * 60 * 1000))
    )
  )
}

/**
 * Writes the buyer's review as the app does (`submitReviewWorkflow`, which refuses one the buyer
 * may not write), dated `at`; then moderates it as an operator would, and gives a published
 * review the shop's reply.
 */
async function writeReview(
  container: MedusaContainer,
  { order_id, customer_id, reference, reference_id, review }: ReviewSubject & { order_id: string; customer_id: string; review: SeedReview },
  at: Date
) {
  const { result } = await submitReviewWorkflow(container).run({
    input: { order_id, customer_id, reference, reference_id, rating: review.rating, customer_note: review.text ?? null },
  })
  await container
    .resolve<{ updateReviews(data: Backdate): Promise<unknown> }>(MercurModules.REVIEW)
    .updateReviews({ id: result.id, created_at: at })
  if (review.status !== "pending") await updateReviewWorkflow(container).run({ input: { id: result.id, status: review.status } })
  if (review.reply) await respondReviewWorkflow(container).run({ input: { id: result.id, seller_note: review.reply } })
}
