// Medusa calls register() before it loads the app, in both the server and the worker.
// Errors go to Sentry (#19) when SENTRY_DSN is set; the API's 5xx responses are reported by
// src/api/report-server-errors.ts, and uncaught exceptions and rejections by the SDK itself.
import * as Sentry from "@sentry/node"

export function register() {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return

  Sentry.init({
    dsn,
    // Railway sets both on every deploy.
    environment: process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV,
    release: process.env.RAILWAY_GIT_COMMIT_SHA,
    serverName: process.env.MEDUSA_WORKER_MODE,
  })
}
