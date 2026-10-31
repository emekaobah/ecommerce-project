import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PRODUCT_NAME } from "@oja/domain"
import { checkUnsubscribeLink, unsubscribe } from "../../../lib/unsubscribe"

// An emailed unsubscribe link (#139), outside /store so it needs no sign-in or publishable key:
// the signed token is the buyer's say-so (lib/unsubscribe.ts). Opening the link (GET) changes
// nothing, since mail scanners fetch links before the buyer sees them: it shows an Unsubscribe
// button, a form that POSTs back to the link. That POST, and mail apps' one-click unsubscribe
// (RFC 8058) to the same address, turn the email off. A link this backend didn't sign, or whose
// buyer is gone, is refused with 404 either way and changes nothing.

const page = (heading: string, body: string) =>
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  `<title>${PRODUCT_NAME}</title>` +
  '<main style="font:16px/1.5 system-ui;padding:24px;max-width:480px">' +
  `<h1 style="font-size:22px">${heading}</h1>${body}</main>`

const CONFIRM = page(
  "Unsubscribe from cart reminders?",
  "<p>You'll stop getting emails about items left in your cart.</p>" +
    // No action: the form posts back to this page's own address.
    '<form method="post"><button type="submit" style="font:inherit;font-weight:700;padding:12px 20px;border:0;border-radius:999px;background:#000;color:#fff">Unsubscribe</button></form>'
)
const UNSUBSCRIBED = page(
  "You're unsubscribed",
  `<p>You won't get emails about items left in your cart. You can turn them back on in the ${PRODUCT_NAME} app, under Account, Notifications.</p>`
)
const REFUSED = page("This link doesn't work", `<p>Turn emails off in the ${PRODUCT_NAME} app instead, under Account, Notifications.</p>`)

const send = (res: MedusaResponse, ok: boolean, html: string) =>
  res
    .status(ok ? 200 : 404)
    .type("html")
    .send(ok ? html : REFUSED)

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  send(res, !!(await checkUnsubscribeLink(req.scope, req.params.token)), CONFIRM)
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  send(res, await unsubscribe(req.scope, req.params.token), UNSUBSCRIBED)
}
