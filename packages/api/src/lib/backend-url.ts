/**
 * Where the backend is reached from outside, for links in emails: `MERCUR_BACKEND_URL` (the API's
 * public origin), else the local server. No trailing slash.
 */
export const backendUrl = (env: NodeJS.ProcessEnv = process.env) =>
  (env.MERCUR_BACKEND_URL?.trim() || "http://localhost:9000").replace(/\/+$/, "")
