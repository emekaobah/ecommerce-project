import { errorHandler, getHttpResponseFromError, type MedusaErrorHandlerFunction } from "@medusajs/framework/http"
import { Refusal } from "../lib/refusal"

/**
 * Answers a `Refusal` (#106) as Medusa would, same status and `{ code, type, message }`, plus
 * its own fields, which Medusa's handler drops. Every other error goes to `handler`.
 */
export function answeringRefusalDetails(handler: MedusaErrorHandlerFunction = errorHandler()): MedusaErrorHandlerFunction {
  return (error, req, res, next) => {
    if (!(error instanceof Refusal)) return handler(error, req, res, next)
    const { statusCode, body } = getHttpResponseFromError(error)
    res.status(statusCode).json({ ...body, ...error.details })
  }
}
