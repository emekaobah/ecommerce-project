import { spawn, type ChildProcess } from "node:child_process"
import path from "node:path"
import { loadEnv } from "@medusajs/framework/utils"
import { Client } from "@medusajs/framework/pg"
import { fakeGoogle } from "../integration-tests/helpers/google"
import { fakePaystack, type SignedWebhook } from "../integration-tests/helpers/paystack"
import { fakeShipbubble } from "../integration-tests/helpers/shipbubble"

/**
 * The backend the apps' Maestro flows run against (#8): a freshly migrated and seeded database,
 * and Paystack, Shipbubble and Google's address lookup answered by the integration tests' network
 * fakes. The fake Paystack's payment page posts each paid transaction's `charge.success` webhook
 * here, and each courier pickup is confirmed a few seconds after its label is booked, as
 * Shipbubble's webhook would. Nothing reaches a real provider; buyers still sign in with the Clerk
 * development instance in `.env`.
 */

const API_DIR = path.resolve(__dirname, "..")
const MEDUSA = path.join(API_DIR, "node_modules/.bin/medusa")

export const E2E_PORT = Number(process.env.E2E_PORT ?? 9001)
export const BACKEND_URL = `http://localhost:${E2E_PORT}`
/** A database of its own, dropped and created again on each start. */
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://oja:oja@localhost:5434/oja_e2e"

/** Where each fake listens. */
const PORTS = {
  paystack: Number(process.env.E2E_PAYSTACK_PORT ?? 9101),
  shipbubble: Number(process.env.E2E_SHIPBUBBLE_PORT ?? 9102),
  google: Number(process.env.E2E_GOOGLE_PORT ?? 9103),
}
/** How long after a label is booked the courier confirms the pickup. */
const CONFIRM_AFTER_MS = 3000

export type E2eBackend = { publishableKey: string; stop: () => Promise<void> }

/** Posts a provider's webhook to the backend, and says so loudly when the backend refuses it. */
async function postWebhook(route: string, { body, headers }: SignedWebhook) {
  const res = await fetch(`${BACKEND_URL}${route}`, { method: "POST", body, headers })
  if (!res.ok) console.error(`\nThe backend refused the webhook to ${route} (${res.status}); its log says why.\n`)
  return res
}

/** Starts the fakes, resets and seeds the database, and starts the backend on `E2E_PORT`. */
export async function startE2eBackend(): Promise<E2eBackend> {
  // The developer's .env gives Clerk's keys; everything that could reach a provider is overridden.
  loadEnv("development", API_DIR)
  if (!process.env.CLERK_JWT_KEY && !process.env.CLERK_SECRET_KEY) {
    throw new Error("Set CLERK_JWT_KEY (or CLERK_SECRET_KEY) in packages/api/.env: the buyer app signs in with Clerk.")
  }

  const paystack = fakePaystack(PORTS.paystack, {
    secretKey: "sk_test_oja_e2e",
    postWebhook: (webhook) => postWebhook("/hooks/payment/paystack_paystack", webhook),
  })
  const shipbubble = fakeShipbubble(PORTS.shipbubble, {
    apiKey: "sb_sandbox_oja_e2e",
    onLabelBooked: (orderId) => {
      setTimeout(() => {
        postWebhook("/hooks/shipbubble", shipbubble.webhook(orderId, "confirmed")).catch((error: unknown) =>
          console.error(`\nCouldn't post Shipbubble's pickup confirmation for ${orderId}:`, error)
        )
      }, CONFIRM_AFTER_MS)
    },
  })
  const google = fakeGoogle(PORTS.google, { apiKey: "AIza_oja_e2e" })
  const fakes = [paystack, shipbubble, google]
  const stopFakes = () => Promise.all(fakes.map((f) => f.stop())).then(() => undefined)
  await Promise.all(fakes.map((f) => f.start()))

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

  let backend: ChildProcess | undefined
  const stopBackend = () =>
    new Promise<void>((resolve) => {
      if (!backend || backend.exitCode != null || backend.signalCode != null) return resolve()
      backend.once("exit", () => resolve())
      backend.kill("SIGTERM")
    })
  try {
    await resetDatabase(DATABASE_URL)
    await run(["db:migrate"], env)
    await run(["exec", "./src/scripts/seed.ts"], env)
    backend = spawn(MEDUSA, ["start", "-p", String(E2E_PORT)], { cwd: API_DIR, env, stdio: "inherit" })
    await waitForHealth(backend)
    const key = await publishableKey(DATABASE_URL)
    return {
      publishableKey: key,
      stop: async () => {
        await stopBackend()
        await stopFakes()
      },
    }
  } catch (error) {
    await stopBackend()
    await stopFakes()
    throw error
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
    if (!rows[0]) throw new Error("The seed made no publishable API key")
    return rows[0].token as string
  } finally {
    await client.end()
  }
}

function run(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(MEDUSA, args, { cwd: API_DIR, env, stdio: "inherit" })
    child.once("error", reject)
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`medusa ${args.join(" ")} exited with ${code}`))))
  })
}

/** Waits for the backend to answer `/health`, or fails as soon as it can't start or exits. */
function waitForHealth(backend: ChildProcess, timeoutMs = 180_000) {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const settle = (error?: Error) => {
      if (settled) return
      settled = true
      clearInterval(poll)
      clearTimeout(deadline)
      backend.off("error", onError)
      backend.off("exit", onExit)
      if (error) reject(error)
      else resolve()
    }
    const onError = (error: Error) => settle(new Error(`Couldn't start the backend: ${error.message}`))
    const onExit = (code: number | null, signal: string | null) =>
      settle(new Error(`The backend exited with ${code ?? signal} before it was healthy`))
    backend.once("error", onError)
    backend.once("exit", onExit)
    const poll = setInterval(() => {
      void fetch(`${BACKEND_URL}/health`).then(
        (r) => r.ok && settle(),
        () => undefined
      )
    }, 1000)
    const deadline = setTimeout(
      () => settle(new Error(`The backend wasn't healthy on ${BACKEND_URL} after ${timeoutMs / 1000}s`)),
      timeoutMs
    )
  })
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
