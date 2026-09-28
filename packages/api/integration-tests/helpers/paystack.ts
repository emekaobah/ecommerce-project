import { createHmac, randomUUID } from "node:crypto"
import { createServer, type IncomingMessage, type Server } from "node:http"

type Transaction = {
  id: number
  reference: string
  amount: number
  currency: string
  email: string
  callback_url?: string
  metadata: Record<string, unknown>
  status: "abandoned" | "success" | "failed"
}

/**
 * Stands in for Paystack's API: the backend's `apiUrl` points here. It initialises and
 * verifies transactions like Paystack, and a test settles them (`pay`, `fail`) and signs
 * `charge.success` webhooks with the same secret key.
 */
export function fakePaystack(port: number) {
  const secretKey = `sk_test_${randomUUID().replaceAll("-", "")}`
  const transactions = new Map<string, Transaction>()
  let server: Server | undefined

  const readBody = async (req: IncomingMessage) => {
    let raw = ""
    for await (const chunk of req) raw += chunk
    return raw ? JSON.parse(raw) : {}
  }

  const handle = async (req: IncomingMessage) => {
    if (req.headers.authorization !== `Bearer ${secretKey}`) {
      return { status: 401, body: { status: false, message: "Invalid key" } }
    }
    if (req.method === "POST" && req.url === "/transaction/initialize") {
      const body = await readBody(req)
      const reference = `ref_${randomUUID()}`
      transactions.set(reference, {
        id: transactions.size + 1,
        reference,
        amount: body.amount,
        currency: body.currency,
        email: body.email,
        callback_url: body.callback_url,
        metadata: typeof body.metadata === "string" ? JSON.parse(body.metadata) : body.metadata ?? {},
        status: "abandoned",
      })
      return {
        status: 200,
        body: {
          status: true,
          message: "Authorization URL created",
          data: { reference, access_code: `ac_${reference}`, authorization_url: `https://checkout.paystack.test/${reference}` },
        },
      }
    }
    const verify = req.url?.match(/^\/transaction\/verify\/(.+)$/)
    if (req.method === "GET" && verify) {
      const transaction = transactions.get(decodeURIComponent(verify[1]))
      if (!transaction) return { status: 400, body: { status: false, message: "Transaction reference not found" } }
      return { status: 200, body: { status: true, message: "Verification successful", data: transaction } }
    }
    return { status: 404, body: { status: false, message: "Not found" } }
  }

  const transaction = (reference: string) => {
    const found = transactions.get(reference)
    if (!found) throw new Error(`No Paystack transaction ${reference}`)
    return found
  }

  /** A signed `charge.success` webhook for a transaction, as Paystack would post it. */
  const chargeSuccess = (reference: string, { signedWith = secretKey }: { signedWith?: string } = {}) => {
    const { id, amount, currency, metadata } = transaction(reference)
    const body = JSON.stringify({
      event: "charge.success",
      data: { id, reference, amount, currency, status: "success", metadata },
    })
    const signature = createHmac("sha512", signedWith).update(body).digest("hex")
    return { body, headers: { "content-type": "application/json", "x-paystack-signature": signature } }
  }

  return {
    secretKey,
    apiUrl: `http://127.0.0.1:${port}`,
    start: () =>
      new Promise<void>((resolve) => {
        server = createServer((req, res) => {
          void handle(req).then(({ status, body }) => {
            res.writeHead(status, { "content-type": "application/json" })
            res.end(JSON.stringify(body))
          })
        })
        server.listen(port, "127.0.0.1", resolve)
      }),
    stop: () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
    transaction,
    /** The buyer paid on Paystack's page. */
    pay: (reference: string) => void (transaction(reference).status = "success"),
    /** The buyer's card was declined. */
    fail: (reference: string) => void (transaction(reference).status = "failed"),
    chargeSuccess,
  }
}
