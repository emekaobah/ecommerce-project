import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PRODUCT_NAME } from "@oja/domain"
import { unsubscribe } from "../../../lib/unsubscribe"

// An emailed unsubscribe link (#139), outside /store so it needs no sign-in or publishable key:
// the signed token is the buyer's say-so (lib/unsubscribe.ts). Opening the link (GET) turns the
// email off and says so; mail apps' one-click unsubscribe (RFC 8058) POSTs to the same address.
// A link this backend didn't sign, or whose buyer is gone, is refused with 404 and changes nothing.

const page = (heading: string, body: string) =>
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  `<title>${PRODUCT_NAME}</title>` +
  '<main style="font:16px/1.5 system-ui;padding:24px;max-width:480px">' +
  `<h1 style="font-size:22px">${heading}</h1><p>${body}</p></main>`

const UNSUBSCRIBED = page(
  "You're unsubscribed",
  `You won't get emails about items left in your cart. You can turn them back on in the ${PRODUCT_NAME} app, under Account, Notifications.`
)
const REFUSED = page("This link doesn't work", `Turn emails off in the ${PRODUCT_NAME} app instead, under Account, Notifications.`)

async function handle(req: MedusaRequest, res: MedusaResponse) {
  const done = await unsubscribe(req.scope, req.params.token)
  res
    .status(done ? 200 : 404)
    .type("html")
    .send(done ? UNSUBSCRIBED : REFUSED)
}

export const GET = handle
export const POST = handle
