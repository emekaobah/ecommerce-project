import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { backfillOrderFulfilments } from "../lib/order-fulfilment"

/**
 * Every order gets a fulfilment row, and every row says whose order it is (#58). Run once by
 * `medusa db:migrate`, after the links the rows are filled from are synced.
 */
export default async function backfillOrderFulfilmentsScript({ container }: Pick<ExecArgs, "container">) {
  const { created, filled } = await backfillOrderFulfilments(container)
  container
    .resolve(ContainerRegistrationKeys.LOGGER)
    .info(`Order fulfilments backfilled: ${created} orders given a row, ${filled} rows told whose order they are`)
}
