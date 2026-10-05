import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { liveSellerIds } from "../../lib/onboarding"

type Query = { graph: (config: GraphConfig, ...rest: unknown[]) => Promise<unknown> }
type GraphConfig = { entity: string; filters?: Record<string, unknown> } & Record<string, unknown>

/** The ids a filter on `key` asks for, narrowed to `allowed`; all of `allowed` when it asks for none. */
function narrowed(filters: Record<string, unknown> | undefined, key: string, allowed: Set<string>): string[] {
  const asked = filters?.[key]
  if (asked == null) return [...allowed]
  const ids = (Array.isArray(asked) ? asked : [asked]).filter((id): id is string => typeof id === "string")
  return ids.filter((id) => allowed.has(id))
}

/**
 * The request's container, with every query it makes for offers or sellers narrowed to live
 * shops. Mercur's store routes for offers, sellers and products (with each variant's cheapest
 * offer) read through `req.scope`, so this hides a shop that isn't live from all of them
 * without copying their handlers, whatever order their own middlewares run in.
 */
function scopeOfLiveShops(scope: MedusaContainer, live: Set<string>): MedusaContainer {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as Query
  const graph = (config: GraphConfig, ...rest: unknown[]) => {
    const key = config.entity === "offer" ? "seller_id" : config.entity === "seller" ? "id" : null
    const filters = key ? { ...config.filters, [key]: narrowed(config.filters, key, live) } : config.filters
    return query.graph({ ...config, filters }, ...rest)
  }
  const liveQuery = Object.create(query, { graph: { value: graph } })
  const resolve = (key: string, ...rest: unknown[]) =>
    key === ContainerRegistrationKeys.QUERY ? liveQuery : (scope.resolve as (...args: unknown[]) => unknown)(key, ...rest)
  return Object.create(scope, { resolve: { value: resolve } })
}

/** Buyers see only live shops and their offers through Mercur's store routes (#26). */
export async function onlyLiveShops(req: MedusaRequest, _res: MedusaResponse, next: MedusaNextFunction) {
  try {
    req.scope = scopeOfLiveShops(req.scope, new Set(await liveSellerIds(req.scope)))
    next()
  } catch (error) {
    next(error)
  }
}
