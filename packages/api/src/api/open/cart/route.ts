import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { appIdentity, PRODUCT_NAME } from "@oja/domain"

// The cart reminder email's button (#139) links here, not to the app's own link: Gmail on the
// web and many mail apps strip links that aren't http(s). The page sends the phone on to the
// buyer app's Cart tab, with an "Open Oja" button for when it doesn't go by itself. A `from`
// marker (`?from=cart_reminder`, story 38) is passed on to the app, so an open from a reminder
// can be told apart; anything else in it is dropped.

/** A marker is a short snake_case word, so it is safe in a link and in the page as it is. */
const MARKER = /^[a-z_]{1,40}$/

export const GET = (req: MedusaRequest, res: MedusaResponse) => {
  const from = typeof req.query.from === "string" && MARKER.test(req.query.from) ? req.query.from : null
  const appLink = `${appIdentity("buyer").scheme}://cart${from ? `?from=${from}` : ""}`
  res
    .status(200)
    .type("html")
    .send(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        `<meta http-equiv="refresh" content="0;url=${appLink}">` +
        `<title>${PRODUCT_NAME}</title>` +
        '<main style="font:16px/1.5 system-ui;padding:24px;max-width:480px">' +
        `<p>Opening your cart in the ${PRODUCT_NAME} app.</p>` +
        `<a href="${appLink}" style="display:inline-block;font-weight:700;padding:12px 20px;border-radius:999px;background:#000;color:#fff;text-decoration:none">Open ${PRODUCT_NAME}</a>` +
        "</main>"
    )
}
