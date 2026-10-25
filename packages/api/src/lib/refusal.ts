import { MedusaError } from "@medusajs/framework/utils"
import type { CheckoutRefusalCode, CheckoutRefusalDetails } from "@oja/domain"

/**
 * A refusal the app words itself from its `code` (#106), with the fields it needs for that,
 * such as the shop it names (`seller`). Answered with the status and body Medusa gives its
 * error, plus `details` (`api/refusal-details.ts`). Thrown outside workflows: a workflow
 * rethrows an error serialized, without them.
 */
export class Refusal extends MedusaError {
  constructor(
    type: string,
    message: string,
    readonly code: CheckoutRefusalCode,
    readonly details?: CheckoutRefusalDetails
  ) {
    super(type, message, code)
  }
}
