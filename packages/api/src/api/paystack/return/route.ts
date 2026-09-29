import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * Where Paystack sends the buyer after paying or cancelling. Paystack only redirects to an
 * http(s) `callback_url`, so the app's payment WebView catches this address and never loads it
 * (docs/adr/0003-paystack-payments.md); the page is only for a browser that does.
 */
export const GET = async (_req: MedusaRequest, res: MedusaResponse) => {
  res
    .status(200)
    .type("html")
    .send(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
        "<title>Oja</title><p style=\"font:16px system-ui;padding:24px\">You can close this page and return to Oja.</p>"
    )
}
