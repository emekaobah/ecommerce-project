import { spawn, type ChildProcess } from "node:child_process"
import { createServer, type Server } from "node:http"
import path from "node:path"
import { loadEnv } from "@medusajs/framework/utils"
import { Client } from "@medusajs/framework/pg"
import { fakeGoogle } from "../integration-tests/helpers/google"
import { fakePaystack } from "../integration-tests/helpers/paystack"
import { fakeShipbubble } from "../integration-tests/helpers/shipbubble"

/**
 * The backend the apps' Maestro flows run against (#8): a freshly migrated and seeded database,
 * and Paystack, Shipbubble and Google's address lookup answered by the integration tests' network
 * fakes. On top of the fakes, it serves Paystack's payment page (Pay posts the signed
 * `charge.success` webhook and returns to the app), and confirms each courier pickup a few
 * seconds after its label is booked, as Shipbubble's webhook would. Nothing reaches a real
 * provider; buyers still sign in with the Clerk development instance in `.env`.
 */

const API_DIR = path.resolve(__dirname, "..")
const MEDUSA = path.join(API_DIR, "node_modules/.bin/medusa")

export const E2E_PORT = Number(process.env.E2E_PORT ?? 9001)
export const BACKEND_URL = `http://localhost:${E2E_PORT}`
/** A database of its own, dropped and created again on each start. */
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://oja:oja@localhost:5434/oja_e2e"

const PORTS = { paystack: 9101, checkout: 9102, shipbubble: 9103, google: 9104 }
/** How long after a label is booked the courier confirms the pickup. */
const CONFIRM_AFTER_MS = 3000

export type E2eBackend = { publishableKey: string; stop: () => Promise<void> }

/** Starts the fakes, resets and seeds the database, and starts the backend on `E2E_PORT`. */
export async function startE2eBackend(): Promise<E2eBackend> {
  // The developer's .env gives Clerk's keys; everything that could reach a provider is overridden.
  loadEnv("development", API_DIR)
  if (!process.env.CLERK_JWT_KEY && !process.env.CLERK_SECRET_KEY) {
    throw new Error("Set CLERK_JWT_KEY (or CLERK_SECRET_KEY) in packages/api/.env: the buyer app signs in with Clerk.")
  }

  const post = (route: string, { body, headers }: { body: string; headers: Record<string, string> }) =>
    fetch(`${BACKEND_URL}${route}`, { method: "POST", body, headers })

  const paystack = fakePaystack(PORTS.paystack, {
    secretKey: "sk_test_oja_e2e",
    checkoutUrl: `http://127.0.0.1:${PORTS.checkout}`,
  })
  const shipbubble = fakeShipbubble(PORTS.shipbubble, {
    apiKey: "sb_sandbox_oja_e2e",
    onLabelBooked: (orderId) => {
      setTimeout(() => void post("/hooks/shipbubble", shipbubble.webhook(orderId, "confirmed")), CONFIRM_AFTER_MS)
    },
  })
  const google = fakeGoogle(PORTS.google, { apiKey: "AIza_oja_e2e" })
  const checkout = paystackCheckout(PORTS.checkout, paystack, (reference) =>
    post("/hooks/payment/paystack_paystack", paystack.chargeSuccess(reference))
  )
  await Promise.all([paystack.start(), shipbubble.start(), google.start(), checkout.start()])

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "development",
    DATABASE_URL,
    // In-memory event bus and workflow engine, so a running dev server's queues stay its own.
    REDIS_URL: "",
    JWT_SECRET: "oja-e2e",
    COOKIE_SECRET: "oja-e2e",
    PAYSTACK_SECRET_KEY: paystack.secretKey,
    PAYSTACK_API_URL: paystack.apiUrl,
    SHIPBUBBLE_API_KEY: shipbubble.apiKey,
    SHIPBUBBLE_API_URL: shipbubble.apiUrl,
    GOOGLE_MAPS_API_KEY: google.apiKey,
    GOOGLE_PLACES_API_URL: google.placesUrl,
    GOOGLE_GEOCODING_API_URL: google.geocodingUrl,
    // The fake resolves any 10-digit account at a bank it lists, so every seeded shop goes live.
    SEED_BANK_CODE: "058",
    SEED_BANK_ACCOUNT_NUMBER: "0123456789",
    // No emails, error reports, storefront, product databases or AI: the local providers log instead.
    RESEND_API_KEY: "",
    SENTRY_DSN: "",
    STOREFRONT_REVALIDATE_URL: "",
    ENRICHMENT_SOURCES: "",
    ANTHROPIC_API_KEY: "",
    EXPO_ACCESS_TOKEN: "",
  }

  const fakes = [paystack, shipbubble, google, checkout]
  const stopFakes = () => Promise.all(fakes.map((f) => f.stop())).then(() => undefined)
  let backend: ChildProcess | undefined
  try {
    await resetDatabase(DATABASE_URL)
    await run(["db:migrate"], env)
    await run(["exec", "./src/scripts/seed.ts"], env)
    backend = spawn(MEDUSA, ["start", "-p", String(E2E_PORT)], { cwd: API_DIR, env, stdio: "inherit" })
    await waitForHealth(backend)
  } catch (error) {
    backend?.kill()
    await stopFakes()
    throw error
  }

  return {
    publishableKey: await publishableKey(DATABASE_URL),
    stop: async () => {
      await new Promise<void>((resolve) => {
        if (backend!.exitCode != null) return resolve()
        backend!.once("exit", () => resolve())
        backend!.kill("SIGTERM")
      })
      await stopFakes()
    },
  }
}

/**
 * Paystack's payment page for the fake's transactions: one Pay button, which settles the
 * transaction, posts its webhook, and sends the buyer to the checkout's callback URL as Paystack does.
 */
function paystackCheckout(
  port: number,
  paystack: ReturnType<typeof fakePaystack>,
  sendWebhook: (reference: string) => Promise<Response>
) {
  let server: Server | undefined
  const page = (reference: string) => `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Paystack</title></head>
<body style="font-family: -apple-system, sans-serif; padding: 24px">
<h1>Paystack test checkout</h1>
<p>NGN ${(paystack.transaction(reference).amount / 100).toLocaleString("en-NG")}</p>
<form method="post" action="/${encodeURIComponent(reference)}/pay"><button style="font-size: 20px; padding: 12px 24px">Pay</button></form>
</body></html>`

  const handle = async (method: string, url: string) => {
    const [, reference, action] = /^\/([^/]+)(\/pay)?$/.exec(url) ?? []
    const known = reference && (() => {
      try {
        return paystack.transaction(decodeURIComponent(reference))
      } catch {
        return undefined
      }
    })()
    if (!known) return { status: 404, headers: {}, body: "No such transaction" }
    if (method === "GET" && !action) return { status: 200, headers: { "content-type": "text/html" }, body: page(known.reference) }
    if (method === "POST" && action) {
      paystack.pay(known.reference)
      const webhook = await sendWebhook(known.reference)
      if (!webhook.ok) return { status: 502, headers: {}, body: `The backend refused the webhook (${webhook.status})` }
      const location = `${known.callback_url}?trxref=${known.reference}&reference=${known.reference}`
      return { status: 302, headers: { location }, body: "" }
    }
    return { status: 405, headers: {}, body: "Method not allowed" }
  }

  return {
    start: () =>
      new Promise<void>((resolve) => {
        server = createServer((req, res) => {
          void handle(req.method ?? "GET", req.url ?? "/").then(({ status, headers, body }) => {
            res.writeHead(status, headers)
            res.end(body)
          })
        })
        server.listen(port, "127.0.0.1", resolve)
      }),
    stop: () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
  }
}

async function resetDatabase(url: string) {
  const target = new URL(url)
  const name = target.pathname.slice(1)
  const admin = new URL(url)
  admin.pathname = "/postgres"
  const client = new Client({ connectionString: admin.toString() })
  await client.connect()
  try {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    await client.query(`CREATE DATABASE "${name}"`)
  } finally {
    await client.end()
  }
}

async function publishableKey(url: string) {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const { rows } = await client.query(
      "SELECT token FROM api_key WHERE type = 'publishable' AND revoked_at IS NULL AND deleted_at IS NULL ORDER BY created_at LIMIT 1"
    )
    return rows[0].token as string
  } finally {
    await client.end()
  }
}

function run(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(MEDUSA, args, { cwd: API_DIR, env, stdio: "inherit" })
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`medusa ${args.join(" ")} exited with ${code}`))))
  })
}

async function waitForHealth(backend: ChildProcess, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (backend.exitCode != null) throw new Error(`The backend exited with ${backend.exitCode}`)
    const healthy = await fetch(`${BACKEND_URL}/health`).then((r) => r.ok, () => false)
    if (healthy) return
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`The backend wasn't healthy on ${BACKEND_URL} after ${timeoutMs / 1000}s`)
}

if (require.main === module) {
  startE2eBackend().then(
    ({ publishableKey, stop }) => {
      console.log(`\nE2E backend ready on ${BACKEND_URL}. Start Metro in apps/mobile-buyer with:`)
      console.log(`  EXPO_PUBLIC_API_URL=${BACKEND_URL} EXPO_PUBLIC_PUBLISHABLE_KEY=${publishableKey} bunx expo start --dev-client`)
      console.log(`or in apps/mobile-vendor with:`)
      console.log(`  EXPO_PUBLIC_API_URL=${BACKEND_URL} bunx expo start --dev-client`)
      const shutdown = () => void stop().then(() => process.exit(0))
      process.once("SIGINT", shutdown)
      process.once("SIGTERM", shutdown)
    },
    (error) => {
      console.error(error)
      process.exit(1)
    }
  )
}
