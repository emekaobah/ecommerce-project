import type { MedusaContainer } from "@medusajs/framework/types"
import { seedDemoWorld } from "../../src/scripts/seed"
import { buyerCheckout } from "./checkout"
import { fakeClerk } from "./clerk"
import { fakePaystack } from "./paystack"
import { fakeShipbubble } from "./shipbubble"

// What a checkout suite runs against: fake Clerk, Paystack and Shipbubble, the seeded demo
// marketplace, and Ada's checkout as a buyer.

/**
 * The fakes, named in the environment. Call it at the top of the spec: the runner loads
 * medusa-config, which registers each provider only when its key is set, before the suite runs.
 * `portBase` gives each fake a port per test process, so it can be named before it is listening.
 */
export function checkoutFakes(portBase: number) {
  const clerk = fakeClerk()
  const paystack = fakePaystack(portBase + (process.pid % 1000))
  const shipbubble = fakeShipbubble(portBase + 1000 + (process.pid % 1000))
  process.env.CLERK_JWT_KEY = clerk.jwtKey
  process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
  process.env.PAYSTACK_API_URL = paystack.apiUrl
  process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
  process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl
  return { clerk, paystack, shipbubble }
}

/**
 * Ada's checkout in a suite: starts the fakes and seeds the demo data before it, stops the fakes
 * after it, and signs Ada in before each test.
 */
export function checkoutSuite({
  api,
  getContainer,
  fakes: { clerk, paystack, shipbubble },
}: {
  api: Parameters<typeof buyerCheckout>[0]["api"]
  getContainer: () => MedusaContainer
  fakes: ReturnType<typeof checkoutFakes>
}) {
  const buyer = buyerCheckout({ api, getContainer, clerk, paystack })
  beforeAll(async () => {
    await Promise.all([paystack.start(), shipbubble.start()])
    await seedDemoWorld({ container: getContainer(), args: [] } as any)
  })
  afterAll(() => Promise.all([paystack.stop(), shipbubble.stop()]))
  beforeEach(() => buyer.load())
  return buyer
}

/** The HTTP status a request answers with, success or not. */
export const statusOf = (request: Promise<unknown>) =>
  request.then(
    () => 200,
    (e: any) => e.response?.status as number
  )
