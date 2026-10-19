import { createHmac, randomUUID } from "node:crypto"
import { createServer, type IncomingMessage, type Server } from "node:http"
import type { PaystackRefundStatus, PaystackTransferStatus } from "../../src/modules/paystack/client"

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
  createdAt: string
}

/** A refund retried to the buyer's bank account (POST /refund/retry_with_customer_details/:id). */
type RefundRetry = { refund_id: number; currency: string; account_number: string; bank_id: string | number }

type Transfer = {
  id: number
  transfer_code: string
  reference: string
  amount: number
  currency: string
  recipient: string
  reason: string
  status: PaystackTransferStatus
}

/** Nigerian banks as Paystack lists them (GET /bank?currency=NGN), a few of them. */
export const BANKS = [
  { id: 1, name: "Access Bank", slug: "access-bank", code: "044", currency: "NGN", type: "nuban", active: true },
  { id: 9, name: "Guaranty Trust Bank", slug: "guaranty-trust-bank", code: "058", currency: "NGN", type: "nuban", active: true },
  { id: 21, name: "Zenith Bank", slug: "zenith-bank", code: "057", currency: "NGN", type: "nuban", active: true },
  { id: 171, name: "OPay Digital Services Limited (OPay)", slug: "paycom", code: "999992", currency: "NGN", type: "nuban", active: true },
]

/** What the fake names an account it resolves: Paystack answers with the holder's name in capitals. */
export const accountName = (accountNumber: string) => `OJA TEST HOLDER ${accountNumber.slice(-4)}`

/** How Paystack refuses an account it can't find (422). */
const UNRESOLVED = "Could not resolve account name. Check parameters or try again."

/** How Paystack's test mode refuses a bank lookup past its daily allowance (429). */
const RESOLVE_LIMIT = "Test mode daily limit of 3 live bank resolves exceeded. Use test bank codes 001 or upgrade to live mode."

/** A webhook as Paystack posts it: the JSON body, signed in `x-paystack-signature`. */
export type SignedWebhook = { body: string; headers: Record<string, string> }

/** An HTTP reply the fake writes as it is. */
type PageReply = { status: number; headers: Record<string, string>; body: string }
const page = (status: number, body: string): PageReply => ({
  status,
  headers: { "content-type": status === 200 ? "text/html" : "text/plain" },
  body,
})

const paymentPage = ({ reference, amount }: { reference: string; amount: number }) => `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Paystack</title></head>
<body style="font-family: -apple-system, sans-serif; padding: 24px">
<h1>Paystack test checkout</h1>
<p>NGN ${(amount / 100).toLocaleString("en-NG")}</p>
<form method="post" action="/checkout/${encodeURIComponent(reference)}/pay"><button style="font-size: 20px; padding: 12px 24px">Pay</button></form>
</body></html>`

type Recipient = {
  recipient_code: string
  type: string
  name: string
  currency: string
  details: { account_number: string; account_name: string; bank_code: string; bank_name: string }
}

/**
 * Stands in for Paystack's API: the backend's `apiUrl` points here. It initialises and
 * verifies transactions and takes refunds like Paystack, and a test settles them (`pay`,
 * `fail`, `settleRefund`) and signs `charge.success` and `refund.*` webhooks with the same
 * secret key. It lists `BANKS`, resolves any 10-digit account at one of them (as
 * `accountName`) unless a test says it doesn't exist (`unknownAccount`) or has used up the
 * daily lookups (`limitResolves`), and creates transfer recipients for accounts it resolves. It
 * queues transfers to those recipients, which a test settles (`settleTransfer`) and signs
 * `transfer.*` webhooks for, and lists refunds by date, including any a test made by hand
 * (`refundByHand`). A refund a test moved to `needs-attention` can be retried to a bank
 * account at one of `BANKS` (`retries`), and is then processing again.
 *
 * A transaction's `authorization_url` opens Paystack's payment page on the fake: one Pay
 * button, which settles the transaction, hands its signed `charge.success` webhook to
 * `postWebhook`, and sends the buyer to the transaction's callback URL as Paystack does.
 */
export function fakePaystack(
  port: number,
  {
    secretKey = `sk_test_${randomUUID().replaceAll("-", "")}`,
    postWebhook,
  }: {
    /** The secret key the backend must send; a fresh one by default. */
    secretKey?: string
    /** Delivers the webhook of a transaction paid on the payment page; without it, Pay is refused. */
    postWebhook?: (webhook: SignedWebhook) => Promise<{ ok: boolean; status: number }>
  } = {}
) {
  const apiUrl = `http://127.0.0.1:${port}`
  const transactions = new Map<string, Transaction>()
  const refunds = new Map<number, Refund>()
  const retries: RefundRetry[] = []
  let refundError: string | undefined
  const unknownAccounts = new Set<string>()
  let resolveLimited = false
  const recipients: Recipient[] = []
  const transfers = new Map<string, Transfer>()
  let transferError: string | undefined
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
    const authorization_url = `${apiUrl}/checkout/${reference}`
    return ok("Authorization URL created", { reference, access_code: `ac_${reference}`, authorization_url })
  }

  const verify = (reference: string) => {
    const found = transactions.get(decodeURIComponent(reference))
    return found ? ok("Verification successful", found) : refused(400, "Transaction reference not found")
  }

  const createRefund = async (req: IncomingMessage) => {
    const body = await readBody(req)
    if (refundError && transactions.has(body.transaction)) return refused(400, refundError)
    return refundTransaction(body)
  }

  /** Paystack's refund of a transaction, however it was asked for. */
  const refundTransaction = (body: { transaction: string; amount?: number; merchant_note?: string }) => {
    const refunded = transactions.get(body.transaction)
    if (!refunded) return refused(400, "Transaction reference not found")
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
      createdAt: new Date().toISOString(),
    }
    refunds.set(queued.id, queued)
    // As Paystack test mode does, even for a partial refund.
    refunded.status = "reversal-pending"
    return ok("Refund has been queued for processing", queued)
  }

  /** Paystack retries a refund that needs attention to the buyer's bank account: it is processing again. */
  const retryRefund = async (req: IncomingMessage, id: string) => {
    const body = await readBody(req)
    const found = refunds.get(Number(id))
    if (!found) return refused(404, "Refund not found")
    if (found.status !== "needs-attention") return refused(400, "Refund does not need attention")
    const details = body.refund_account_details ?? {}
    const known = BANKS.some((b) => String(b.id) === String(details.bank_id))
    if (!known || !/^\d{10}$/.test(details.account_number ?? "") || details.currency !== found.currency) {
      return refused(400, "Invalid refund account details")
    }
    retries.push({ refund_id: found.id, ...details })
    found.status = "processing"
    return ok("Refund retried and has been queued for processing", found)
  }

  const fetchRefund = (id: string) => {
    const found = refunds.get(Number(id))
    return found ? ok("Refund retrieved", found) : refused(404, "Refund not found")
  }

  /** Refunds made between `from` and `to`, a page at a time, as Paystack lists them: the transaction by its id. */
  const listRefunds = (req: IncomingMessage) => {
    const params = new URL(req.url ?? "", "https://paystack.test").searchParams
    const from = new Date(params.get("from") ?? 0).getTime()
    const to = new Date(params.get("to") ?? Date.now()).getTime()
    const perPage = Number(params.get("perPage") ?? 50)
    const page = Number(params.get("page") ?? 1)
    const inPeriod = [...refunds.values()].filter((r) => {
      const at = new Date(r.createdAt).getTime()
      return at >= from && at <= to
    })
    const listed = inPeriod.slice((page - 1) * perPage, page * perPage).map((r) => ({ ...r, transaction: r.transaction.id }))
    return ok("Refunds retrieved", listed)
  }

  const createTransfer = async (req: IncomingMessage) => {
    const body = await readBody(req)
    if (transferError) return refused(400, transferError)
    if (body.source !== "balance") return refused(400, "Invalid source")
    if (!recipients.some((r) => r.recipient_code === body.recipient)) return refused(400, "Recipient specified is invalid")
    if (!Number.isInteger(body.amount) || body.amount <= 0) return refused(400, "Invalid amount")
    if (transfers.has(body.reference)) return refused(400, "Duplicate Transfer Reference")
    const queued: Transfer = {
      id: transfers.size + 1,
      transfer_code: `TRF_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      reference: body.reference,
      amount: body.amount,
      currency: body.currency,
      recipient: body.recipient,
      reason: body.reason,
      status: "pending",
    }
    transfers.set(queued.reference, queued)
    return ok("Transfer has been queued", queued)
  }

  const verifyTransfer = (reference: string) => {
    const found = transfers.get(decodeURIComponent(reference))
    return found ? ok("Transfer retrieved", found) : refused(404, "Transfer not found")
  }

  /** The account's holder, as Paystack resolves it, or null when no such account exists. */
  const holderOf = (bankCode: string, accountNumber: string) => {
    const bank = BANKS.find((b) => b.code === bankCode)
    if (!bank || !/^\d{10}$/.test(accountNumber) || unknownAccounts.has(accountNumber)) return null
    return { bank, name: accountName(accountNumber) }
  }

  const resolveAccount = (req: IncomingMessage) => {
    if (resolveLimited) return refused(429, RESOLVE_LIMIT)
    const params = new URL(req.url ?? "", "https://paystack.test").searchParams
    const accountNumber = params.get("account_number") ?? ""
    const holder = holderOf(params.get("bank_code") ?? "", accountNumber)
    if (!holder) return refused(422, UNRESOLVED)
    return ok("Account number resolved", { account_number: accountNumber, account_name: holder.name, bank_id: holder.bank.id })
  }

  const createRecipient = async (req: IncomingMessage) => {
    const body = await readBody(req)
    if (body.type !== "nuban") return refused(400, "Invalid recipient type")
    const holder = holderOf(body.bank_code, body.account_number)
    if (!holder) return refused(422, UNRESOLVED)
    const recipient: Recipient = {
      recipient_code: `RCP_${randomUUID().replaceAll("-", "").slice(0, 14)}`,
      type: body.type,
      name: body.name,
      currency: body.currency,
      details: {
        account_number: body.account_number,
        account_name: holder.name,
        bank_code: body.bank_code,
        bank_name: holder.bank.name,
      },
    }
    recipients.push(recipient)
    return ok("Transfer recipient created successfully", { ...recipient, active: true, id: recipients.length })
  }

  /** Paystack's endpoints the backend calls: method, path, and what answers it. */
  const routes: [string, RegExp, (req: IncomingMessage, param: string) => Reply | Promise<Reply>][] = [
    ["POST", /^\/transaction\/initialize$/, initialize],
    ["GET", /^\/transaction\/verify\/(.+)$/, (_, reference) => verify(reference)],
    ["POST", /^\/refund$/, createRefund],
    ["GET", /^\/refund\/(\d+)$/, (_, id) => fetchRefund(id)],
    ["POST", /^\/refund\/retry_with_customer_details\/(\d+)$/, retryRefund],
    ["GET", /^\/refund\?/, listRefunds],
    ["POST", /^\/transfer$/, createTransfer],
    ["GET", /^\/transfer\/verify\/(.+)$/, (_, reference) => verifyTransfer(reference)],
    ["GET", /^\/bank\?/, () => ok("Banks retrieved", BANKS)],
    ["GET", /^\/bank\/resolve\?/, resolveAccount],
    ["POST", /^\/transferrecipient$/, createRecipient],
  ]

  /** Paystack's payment page, which the buyer's browser opens: no secret key, and HTML rather than JSON. */
  const checkout = async (req: IncomingMessage): Promise<PageReply | undefined> => {
    const [, reference, pay] = /^\/checkout\/([^/?]+)(\/pay)?$/.exec(req.url ?? "") ?? []
    if (!reference) return undefined
    const found = transactions.get(decodeURIComponent(reference))
    if (!found) return page(404, "No such transaction")
    if (req.method === "GET" && !pay) return page(200, paymentPage(found))
    if (req.method !== "POST" || !pay) return page(405, "Method not allowed")
    if (!postWebhook) return page(501, "This fake Paystack was given no postWebhook")
    found.status = "success"
    const delivered = await postWebhook(chargeSuccess(found.reference))
    if (!delivered.ok) return page(502, `The backend refused the charge.success webhook (${delivered.status})`)
    if (!found.callback_url) return page(200, "Paid")
    const back = new URL(found.callback_url)
    back.searchParams.set("trxref", found.reference)
    back.searchParams.set("reference", found.reference)
    return { status: 302, headers: { location: back.toString() }, body: "" }
  }

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

  const signed = (payload: unknown, signedWith = secretKey): SignedWebhook => {
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
    apiUrl,
    start: () =>
      new Promise<void>((resolve) => {
        server = createServer((req, res) => {
          const reply = async (): Promise<PageReply> => {
            const fromPage = await checkout(req)
            if (fromPage) return fromPage
            const { status, body } = await handle(req)
            return { status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
          }
          reply()
            .catch((error: unknown): PageReply => {
              console.error("The fake Paystack failed to answer", req.method, req.url, error)
              return page(500, String(error))
            })
            .then(({ status, headers, body }) => {
              res.writeHead(status, headers)
              res.end(body)
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
    /** Each refund retried to a bank account, oldest first, with the details it was sent. */
    retries: () => [...retries],
    /** Every refund from now on is turned down with this message (e.g. "Insufficient balance"), until cleared. */
    refuseRefunds: (message: string | undefined) => {
      refundError = message
    },
    /** Paystack can't find this account number at any bank from now on. */
    unknownAccount: (accountNumber: string) => {
      unknownAccounts.add(accountNumber)
    },
    /** Every bank lookup is refused with test mode's daily-limit error (429), until cleared. */
    limitResolves: (limited: boolean) => {
      resolveLimited = limited
    },
    /** Every transfer recipient created, oldest first. */
    recipients: () => [...recipients],
    /** Someone refunded a transaction by hand in Paystack's dashboard: no order refund records it. */
    refundByHand: (reference: string, amount?: number) => {
      const { status, body } = refundTransaction({ transaction: reference, amount })
      if (status !== 200) throw new Error(body.message)
      return body.data as Refund
    },
    /** Every transfer made, oldest first. */
    transfers: () => [...transfers.values()],
    /** Paystack settled a transfer: `success`, or `failed` or `reversed`, the money back in our balance. */
    settleTransfer: (reference: string, status: PaystackTransferStatus) => {
      const found = transfers.get(reference)
      if (!found) throw new Error(`No Paystack transfer ${reference}`)
      found.status = status
    },
    /** Every transfer from now on is turned down with this message (e.g. "Your balance is not enough"), until cleared. */
    refuseTransfers: (message: string | undefined) => {
      transferError = message
    },
    /** A signed `transfer.*` webhook for a transfer, as Paystack would post it. */
    transferEvent: (reference: string, { signedWith = secretKey }: { signedWith?: string } = {}) => {
      const found = transfers.get(reference)
      if (!found) throw new Error(`No Paystack transfer ${reference}`)
      const { amount, currency, status, transfer_code } = found
      return signed({ event: `transfer.${status}`, data: { reference, transfer_code, amount, currency, status } }, signedWith)
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
