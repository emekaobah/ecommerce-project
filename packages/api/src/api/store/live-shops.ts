import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { liveSellerIds } from "../../lib/onboarding"

type Query = { graph: (config: GraphConfig, ...rest: unknown[]) => Promise<unknown> }
type GraphConfig = { entity: string; filters?: Record<string, unknown> } & Record<string, unknown>

/** The column each entity Mercur's store routes read is narrowed on to hide shops that aren't live. */
const SHOP_COLUMN: Record<string, string> = { offer: "seller_id", seller: "id" }

/**
 * The request's container, with every query it makes for offers or sellers narrowed to live
 * shops. Mercur's store routes for offers, sellers and products (with each variant's cheapest
 * offer) read through `req.scope`, so this hides a shop that isn't live from all of them
 * without copying their handlers, whatever order their own middlewares run in.
 */
function scopeOfLiveShops(scope: MedusaContainer, live: Set<string>): MedusaContainer {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as Query
  const graph = (config: GraphConfig, ...rest: unknown[]) => {
    const column = SHOP_COLUMN[config.entity]
    if (!column) return query.graph(config, ...rest)
    // An added condition, so whatever the route already filters on (a list, an operator) still holds.
    const and = Array.isArray(config.filters?.$and) ? config.filters.$and : []
    const filters = { ...config.filters, $and: [...and, { [column]: [...live] }] }
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
