import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { publishedReviews, type PublishedReviews } from "../../../../../lib/reviews"
import type { StoreGetPublishedReviewsType } from "../../../reviews/validators"

/**
 * A product's published reviews, newest first, with its rating: their average and count (#7).
 * A product review rates the shared catalogue product, whichever shop sold it, so it shows
 * with the product in every shop.
 */
export const GET = async (
  req: MedusaRequest<unknown, StoreGetPublishedReviewsType>,
  res: MedusaResponse<PublishedReviews & { limit: number; offset: number }>
) => {
  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "product", fields: ["id"], filters: { id, status: "published" } })
  if (!data.length) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Product with id ${id} was not found`)
  const { limit, offset } = req.validatedQuery
  res.json({ ...(await publishedReviews(req.scope, { reference: "product", reference_id: id }, { limit, offset })), offset, limit })
}
