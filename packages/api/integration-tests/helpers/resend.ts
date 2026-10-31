import { randomUUID } from "node:crypto"
import { createServer, type IncomingMessage, type Server } from "node:http"

/** An email as the backend asks Resend to send it. */
export type SentEmail = { from: string; to: string | string[]; subject: string; html?: string; text?: string; headers?: Record<string, string> }

/**
 * Stands in for Resend's API: the backend's `RESEND_API_URL` points here. It accepts every email
 * sent with its API key, answers with an id as Resend does, and records each email for tests to
 * inspect. It refuses emails to an address it is told to, as Resend's test sender refuses every
 * address but the account's own.
 */
export function fakeResend(port: number) {
  const apiKey = `re_${randomUUID().replaceAll("-", "")}`
  const emails: SentEmail[] = []
  const refused = new Set<string>()
  let server: Server | undefined

  const readBody = async (req: IncomingMessage) => {
    let raw = ""
    for await (const chunk of req) raw += chunk
    return raw ? JSON.parse(raw) : {}
  }

  const send = async (req: IncomingMessage) => {
    if (req.headers.authorization !== `Bearer ${apiKey}`) {
      return { status: 401, body: { statusCode: 401, name: "validation_error", message: "API key is invalid" } }
    }
    const email = (await readBody(req)) as SentEmail
    if ([email.to].flat().some((to) => refused.has(to))) {
      return { status: 403, body: { statusCode: 403, name: "validation_error", message: "You can only send testing emails to your own email address" } }
    }
    emails.push(email)
    return { status: 200, body: { id: randomUUID() } }
  }

  return {
    apiKey,
    apiUrl: `http://127.0.0.1:${port}`,
    start: () =>
      new Promise<void>((resolve) => {
        server = createServer((req, res) => {
          const reply =
            req.method === "POST" && req.url === "/emails"
              ? send(req)
              : Promise.resolve({ status: 404, body: { statusCode: 404, name: "not_found", message: "Not found" } })
          void reply.then(({ status, body }) => {
            res.writeHead(status, { "content-type": "application/json" })
            res.end(JSON.stringify(body))
          })
        })
        server.listen(port, "127.0.0.1", resolve)
      }),
    stop: () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
    /** Every email sent to this address, oldest first. */
    sentTo: (address: string) => emails.filter((e) => [e.to].flat().includes(address)),
    /** Resend refuses emails to this address. */
    refuse: (address: string) => {
      refused.add(address)
    },
    reset: () => {
      emails.length = 0
      refused.clear()
    },
  }
}
