import { z } from "@medusajs/framework/zod"

const required = z.string().trim().min(1)

/** A delivery address: the NG form's columns (ADR 0002), with the rider's landmark in metadata. */
export const StoreCheckoutAddress = z.object({
  first_name: required,
  last_name: required,
  address_1: required,
  address_2: z.string().trim().nullish(),
  city: required,
  province: required,
  postal_code: z.string().trim().nullish(),
  country_code: z.string().length(2).toLowerCase(),
  phone: required,
  metadata: z.object({ landmark: z.string().trim().nullish() }).nullish(),
})

export const StorePrepareCheckout = z.object({ shipping_address: StoreCheckoutAddress })
export type StorePrepareCheckoutType = z.infer<typeof StorePrepareCheckout>

export const StoreStartCheckoutPayment = z.object({
  /**
   * Where Paystack sends the buyer after paying or cancelling. Paystack only redirects to an
   * http(s) URL (it drops an app's deep link), so the app passes a page it catches in its WebView.
   */
  return_url: z
    .string()
    .url()
    .refine((url) => /^https?:\/\//.test(url), "Paystack only returns the buyer to an http(s) URL"),
})
export type StoreStartCheckoutPaymentType = z.infer<typeof StoreStartCheckoutPayment>
