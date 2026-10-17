// Medusa calls register() before it loads the app, in both the server and the worker.
// Errors and traces go to Sentry (#19) when SENTRY_DSN is set; the API's 5xx responses are reported by
// src/api/report-server-errors.ts, and uncaught exceptions and rejections by the SDK itself.
import * as Sentry from "@sentry/node"
import { carriesBankAccount, redactAccountNumbers } from "./src/lib/bank-account-redaction"

export function register() {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return

  Sentry.init({
    dsn,
    // Railway sets both on every deploy.
    environment: process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV,
    release: process.env.RAILWAY_GIT_COMMIT_SHA,
    // Tells the API's events from the worker's: both run the same build.
    initialScope: { tags: { worker_mode: process.env.MEDUSA_WORKER_MODE || "shared" } },
    // Traces a tenth of requests, all of checkout and payment, and none of Railway's health
    // checks. Medusa loads Express before register(), so spans are per HTTP request and query,
    // without Express route names.
    tracesSampler: ({ name, inheritOrSampleWith }) => {
      if (name.includes("/health")) return 0
      if (name.includes("/checkout") || name.includes("/hooks/payment")) return 1
      return inheritOrSampleWith(0.1)
    },
    // Bank account numbers go to Paystack only (#13): the bodies that carry one aren't
    // attached, and one anywhere else (Paystack's lookup URL, say) is blanked.
    integrations: [Sentry.httpIntegration({ ignoreRequestBody: (url) => carriesBankAccount(url) })],
    beforeSend: (event) => redactAccountNumbers(event),
    beforeSendTransaction: (event) => redactAccountNumbers(event),
    beforeBreadcrumb: (breadcrumb) => redactAccountNumbers(breadcrumb),
  })
}
