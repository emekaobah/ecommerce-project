import { createHmac, randomUUID } from "node:crypto"
import { createServer, type IncomingMessage, type Server } from "node:http"
import type { PaystackRefundStatus } from "../../src/modules/paystack/client"

type Transaction = {
  id: number
  reference: string
  amount: number
  currency: string
  email: string
  callback_url?: string
  metadata: Record<string, unknown>
  status: "abandoned" | "success" | "failed" | "reversal-pending"
}

type RefundStatus = PaystackRefundStatus
type Refund = {
  id: number
  status: RefundStatus
  amount: number
  currency: string
  merchant_note?: string
  transaction: { id: number; reference: string }
}

/**
 * Stands in for Paystack's API: the backend's `apiUrl` points here. It initialises and
 * verifies transactions and takes refunds like Paystack, and a test settles them (`pay`,
 * `fail`, `settleRefund`) and signs `charge.success` and `refund.*` webhooks with the same
 * secret key.
 */
export function fakePaystack(port: number) {
  const secretKey = `sk_test_${randomUUID().replaceAll("-", "")}`
  const transactions = new Map<string, Transaction>()
  const refunds = new Map<number, Refund>()
  let refundError: string | undefined
  let server: Server | undefined

  const readBody = async (req: IncomingMessage) => {
    let raw = ""
    for await (const chunk of req) raw += chunk
    return raw ? JSON.parse(raw) : {}
  }

  type Reply = { status: number; body: { status: boolean; message: string; data?: unknown } }
  const ok = (message: string, data: unknown): Reply => ({ status: 200, body: { status: true, message, data } })
  const refused = (status: number, message: string): Reply => ({ status, body: { status: false, message } })

  const initialize = async (req: IncomingMessage) => {
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
    const authorization_url = `https://checkout.paystack.test/${reference}`
    return ok("Authorization URL created", { reference, access_code: `ac_${reference}`, authorization_url })
  }

  const verify = (reference: string) => {
    const found = transactions.get(decodeURIComponent(reference))
    return found ? ok("Verification successful", found) : refused(400, "Transaction reference not found")
  }

  const createRefund = async (req: IncomingMessage) => {
    const body = await readBody(req)
    const refunded = transactions.get(body.transaction)
    if (!refunded) return refused(400, "Transaction reference not found")
    if (refundError) return refused(400, refundError)
    if (body.amount != null && body.amount < 5000) return refused(400, "Cannot refund less than NGN50")
    const taken = [...refunds.values()]
      .filter((r) => r.transaction.reference === refunded.reference && r.status !== "failed")
      .reduce((sum, r) => sum + r.amount, 0)
    const amount = body.amount ?? refunded.amount - taken
    if (taken + amount > refunded.amount) return refused(400, "Refund amount cannot be more than the transaction amount")
    const queued: Refund = {
      id: 1000 + refunds.size,
      status: "pending",
      amount,
      currency: refunded.currency,
      merchant_note: body.merchant_note,
      transaction: { id: refunded.id, reference: refunded.reference },
    }
    refunds.set(queued.id, queued)
    // As Paystack test mode does, even for a partial refund.
    refunded.status = "reversal-pending"
    return ok("Refund has been queued for processing", queued)
  }

  const fetchRefund = (id: string) => {
    const found = refunds.get(Number(id))
    return found ? ok("Refund retrieved", found) : refused(404, "Refund not found")
  }

  /** Paystack's endpoints the backend calls: method, path, and what answers it. */
  const routes: [string, RegExp, (req: IncomingMessage, param: string) => Reply | Promise<Reply>][] = [
    ["POST", /^\/transaction\/initialize$/, initialize],
    ["GET", /^\/transaction\/verify\/(.+)$/, (_, reference) => verify(reference)],
    ["POST", /^\/refund$/, createRefund],
    ["GET", /^\/refund\/(\d+)$/, (_, id) => fetchRefund(id)],
  ]

  const handle = async (req: IncomingMessage): Promise<Reply> => {
    if (req.headers.authorization !== `Bearer ${secretKey}`) return refused(401, "Invalid key")
    for (const [method, path, answer] of routes) {
      const match = req.method === method ? req.url?.match(path) : null
      if (match) return answer(req, match[1])
    }
    return refused(404, "Not found")
  }

  const transaction = (reference: string) => {
    const found = transactions.get(reference)
    if (!found) throw new Error(`No Paystack transaction ${reference}`)
    return found
  }

  const signed = (payload: unknown, signedWith = secretKey) => {
    const body = JSON.stringify(payload)
    const signature = createHmac("sha512", signedWith).update(body).digest("hex")
    return { body, headers: { "content-type": "application/json", "x-paystack-signature": signature } }
  }

  /** A signed `charge.success` webhook for a transaction, as Paystack would post it. */
  const chargeSuccess = (reference: string, { signedWith = secretKey }: { signedWith?: string } = {}) => {
    const { id, amount, currency, metadata } = transaction(reference)
    return signed(
      { event: "charge.success", data: { id, reference, amount, currency, status: "success", metadata } },
      signedWith
    )
  }

  const refund = (id: number) => {
    const found = refunds.get(id)
    if (!found) throw new Error(`No Paystack refund ${id}`)
    return found
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
    pay: (reference: string) => {
      transaction(reference).status = "success"
    },
    /** The buyer's card was declined. */
    fail: (reference: string) => {
      transaction(reference).status = "failed"
    },
    chargeSuccess,
    /** The refunds of a transaction, in the order they were made. */
    refundsOf: (reference: string) => [...refunds.values()].filter((r) => r.transaction.reference === reference),
    /** Paystack moved a refund on, e.g. to `processed`, or to `failed` and credited the money back. */
    settleRefund: (id: number, status: RefundStatus) => {
      refund(id).status = status
    },
    /** Every refund from now on is turned down with this message (e.g. "Insufficient balance"), until cleared. */
    refuseRefunds: (message: string | undefined) => {
      refundError = message
    },
    /** A signed `refund.*` webhook for a refund, as Paystack would post it: it names the transaction, not the refund. */
    refundEvent: (id: number) => {
      const { status, amount, currency, transaction } = refund(id)
      return signed({
        event: `refund.${status}`,
        data: { status, amount, currency, transaction_reference: transaction.reference, refund_reference: null },
      })
    },
  }
}
