import { createHash } from "node:crypto"
import { isIPv6 } from "node:net"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import Redis from "ioredis"

// A fixed-window rate limiter (#132), the repo's first: a key may be hit `max` times in each
// `windowSeconds` window. Counts live in Redis when the backend has one (production), so every
// server and worker shares them; otherwise in this process's memory (local runs and tests).
// Keys are stored hashed, so a limit per network address keeps no address.

type Scope = Pick<MedusaContainer, "resolve">

/** A limit: `max` hits per `windowSeconds`, counted per key under `name`. */
export type RateLimit = { name: string; max: number; windowSeconds: number }

/** Counts a hit on a key and says how many there have been in its current window, this one included. */
export type RateLimitStore = { hit: (key: string, windowSeconds: number) => Promise<number> }

/** Counts in this process's memory; a key's window starts at its first hit. */
export function memoryRateLimitStore(clock: () => number = Date.now): RateLimitStore {
  const windows = new Map<string, { count: number; endsAt: number }>()
  return {
    async hit(key, windowSeconds) {
      const now = clock()
      const current = windows.get(key)
      if (current && current.endsAt > now) return ++current.count
      if (windows.size >= 10_000) for (const [k, w] of windows) if (w.endsAt <= now) windows.delete(k)
      windows.set(key, { count: 1, endsAt: now + windowSeconds * 1000 })
      return 1
    },
  }
}

/**
 * The network a client address stands for, to limit by: an IPv4 address itself (IPv4-mapped IPv6
 * included), and an IPv6 address's /64, since a phone or home is given the whole block and could
 * otherwise step through it.
 */
export function clientNetwork(address: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  if (mapped) return mapped[1]
  if (!isIPv6(address)) return address
  const [head, tail = ""] = address.toLowerCase().split("%")[0].split("::")
  const headGroups = head ? head.split(":") : []
  const tailGroups = address.includes("::") && tail ? tail.split(":") : []
  const groups = address.includes("::")
    ? [...headGroups, ...Array(8 - headGroups.length - tailGroups.length).fill("0"), ...tailGroups]
    : headGroups
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`
}

// Counts and starts the window in one step, so no key is left without an expiry.
const HIT_SCRIPT = `local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`

function redisRateLimitStore(url: string): RateLimitStore {
  // Short timeouts, so a slow or lost Redis lets the hit through (below) instead of holding the request.
  const redis = new Redis(url, { maxRetriesPerRequest: 1, connectTimeout: 2000, commandTimeout: 500 })
  // Reconnects are retried on their own; a failed hit is logged by withinRateLimit.
  redis.on("error", () => {})
  return { hit: async (key, windowSeconds) => Number(await redis.eval(HIT_SCRIPT, 1, key, windowSeconds)) }
}

let store: RateLimitStore | undefined

function storeOf(scope: Scope): RateLimitStore {
  if (!store) {
    const { redisUrl } = scope.resolve(ContainerRegistrationKeys.CONFIG_MODULE).projectConfig
    store = redisUrl ? redisRateLimitStore(redisUrl) : memoryRateLimitStore()
  }
  return store
}

/**
 * Counts a hit on `key` under `limit`, and whether it is still within it. When the counts can't be
 * reached it lets the hit through: a limiter outage shouldn't take the route down with it.
 */
export async function withinRateLimit(scope: Scope, limit: RateLimit, key: string): Promise<boolean> {
  const hashed = `ratelimit:${limit.name}:${createHash("sha256").update(key).digest("hex")}`
  try {
    return (await storeOf(scope).hit(hashed, limit.windowSeconds)) <= limit.max
  } catch (error) {
    scope.resolve(ContainerRegistrationKeys.LOGGER).warn(`Rate limit ${limit.name} not checked: ${(error as Error).message}`)
    return true
  }
}
