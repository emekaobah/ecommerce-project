import type { MiddlewareRoute } from "@medusajs/framework/http"

/**
 * A route with RBAC policies. Medusa checks a route's policies (as Mercur's own vendor routes
 * declare them), though its public route type leaves the field out.
 */
export type PolicedRoute = MiddlewareRoute & { policies: { resource: string; operation: string }[] }
