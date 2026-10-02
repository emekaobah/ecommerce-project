import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { OrderShare } from "../../lib/shop-order"

// A shop sees its own share of a checkout split across shops (lib/shop-order). Mercur's vendor
// routes answer through res.json, so what they send is cut down on the way out.

type Body = Record<string, unknown>

/** Sends each response of the routes it guards through `view` first. */
export function viewResponses(view: (req: MedusaRequest, body: Body) => Promise<Body>) {
  return (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
    const send = res.json.bind(res)
    res.json = (body: unknown) => {
      view(req, body as Body).then(send, next)
      return res
    }
    next()
  }
}

/** Each order's total and its own payment transactions. */
export async function sharesOf(scope: MedusaContainer, orderIds: string[]): Promise<Map<string, OrderShare>> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "total", "transactions.amount", "transactions.reference", "transactions.reference_id"],
    filters: { id: orderIds },
  })
  return new Map(
    (data as { id: string; total: number; transactions?: OrderShare["transactions"] | null }[]).map((o) => [
      o.id,
      { total: Number(o.total), transactions: (o.transactions ?? []).map((t) => ({ ...t, amount: Number(t.amount) })) },
    ])
  )
}

/** Never guess a share: showing ₦0 paid would misstate the shop's money. */
export function shareFor(shares: Map<string, OrderShare>, id: string): OrderShare {
  const share = shares.get(id)
  if (!share) throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `No payment share found for ${id}`)
  return share
}
