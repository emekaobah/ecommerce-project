import { ContainerRegistrationKeys, MathBN } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import type { MedusaContainer } from "@medusajs/framework/types"

async function orderTotal(container: Pick<MedusaContainer, "resolve">, orderId: string): Promise<number> {
  const { data } = await container
    .resolve(ContainerRegistrationKeys.QUERY)
    .graph({ entity: "order", fields: ["id", "total"], filters: { id: orderId } })
  return Number(data[0]?.total ?? 0)
}

/** The order's total before its lines are edited. */
export const orderTotalBeforeEditStep = createStep("order-total-before-edit", async ({ order_id }: { order_id: string }, { container }) => {
  return new StepResponse(await orderTotal(container, order_id))
})

/** What an order edit took off the order's total since `total_before`, which is what the buyer is owed. */
export const removedByEditStep = createStep(
  "order-total-removed-by-edit",
  async ({ order_id, total_before }: { order_id: string; total_before: number }, { container }) => {
    return new StepResponse(MathBN.convert(MathBN.sub(total_before, await orderTotal(container, order_id))).toNumber())
  }
)
