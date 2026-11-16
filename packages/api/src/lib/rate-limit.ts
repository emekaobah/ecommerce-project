import { createHash } from "node:crypto"
import { isIPv6 } from "node:net"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import Redis, { type RedisOptions } from "ioredis"

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
  if (!isIPv6(address)) return address
  const groups = ipv6Groups(address)
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff
  if (mapped) return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".")
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`
}

/** A valid IPv6 address's eight 16-bit groups, `::` expanded; a dotted IPv4 tail is the last two. */
function ipv6Groups(address: string): number[] {
  const groupsOf = (part: string) =>
    part
      ? part.split(":").flatMap((g) => {
          if (!g.includes(".")) return [Number.parseInt(g, 16)]
          const [a, b, c, d] = g.split(".").map(Number)
          return [(a << 8) | b, (c << 8) | d]
        })
      : []
  const [head, tail] = address.split("%")[0].split("::")
  if (tail === undefined) return groupsOf(head)
  const [headGroups, tailGroups] = [groupsOf(head), groupsOf(tail)]
  return [...headGroups, ...new Array<number>(8 - headGroups.length - tailGroups.length).fill(0), ...tailGroups]
}

// Counts and starts the window in one step, so no key is left without an expiry.
const HIT_SCRIPT = `local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`

function redisRateLimitStore(url: string, options: RedisOptions = {}): RateLimitStore {
  // The backend's own Redis options (a password, TLS) as Medusa's client gets them, with short
  // timeouts, so a slow or lost Redis lets the hit through (below) instead of holding the request.
  const redis = new Redis(url, { ...options, maxRetriesPerRequest: 1, connectTimeout: 2000, commandTimeout: 500 })
  // Reconnects are retried on their own; a failed hit is logged by withinRateLimit.
  redis.on("error", () => {})
  return { hit: async (key, windowSeconds) => Number(await redis.eval(HIT_SCRIPT, 1, key, windowSeconds)) }
}

let store: RateLimitStore | undefined

function storeOf(scope: Scope): RateLimitStore {
  if (!store) {
    const { redisUrl, redisOptions } = scope.resolve(ContainerRegistrationKeys.CONFIG_MODULE).projectConfig
    store = redisUrl ? redisRateLimitStore(redisUrl, redisOptions) : memoryRateLimitStore()
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
