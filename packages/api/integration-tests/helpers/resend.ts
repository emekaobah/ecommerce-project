import { randomUUID } from "node:crypto"
import { createServer, type IncomingMessage, type Server } from "node:http"

/** An email as the backend asks Resend to send it. */
export type SentEmail = { from: string; to: string | string[]; subject: string; html?: string; text?: string }

/**
 * Stands in for Resend's API: the backend's `RESEND_API_URL` points here. It accepts every email
 * sent with its API key, answers with an id as Resend does, and records each email for tests to
 * inspect.
 */
export function fakeResend(port: number) {
  const apiKey = `re_${randomUUID().replaceAll("-", "")}`
  const emails: SentEmail[] = []
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
    emails.push((await readBody(req)) as SentEmail)
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
    reset: () => {
      emails.length = 0
    },
  }
}
