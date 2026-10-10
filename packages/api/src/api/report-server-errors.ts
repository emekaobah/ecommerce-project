import { errorHandler, getHttpResponseFromError, type MedusaErrorHandlerFunction } from "@medusajs/framework/http"
import * as Sentry from "@sentry/node"

/**
 * Medusa's error handler, reporting first every error it will answer with a 5xx (#19). Client
 * errors (validation, not found, conflicts) are the caller's to fix, so they aren't reported.
 * Sentry is initialised in instrumentation.ts; without a DSN, reporting does nothing.
 */
export function reportServerErrors(
  report: (error: unknown) => void = (error) => Sentry.captureException(error),
  handler: MedusaErrorHandlerFunction = errorHandler(),
): MedusaErrorHandlerFunction {
  return (error, req, res, next) => {
    if (getHttpResponseFromError(error).statusCode >= 500) report(error)
    return handler(error, req, res, next)
  }
}
