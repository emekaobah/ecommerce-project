import { z } from "zod"

export const VendorSaveBankAccount = z.object({
  bank_code: z.string().min(1),
  /** Digits only; Paystack decides whether the bank has the account. */
  account_number: z
    .string()
    .trim()
    .regex(/^\d{6,20}$/, "Enter the account number, digits only"),
})
export type VendorSaveBankAccountType = z.infer<typeof VendorSaveBankAccount>

const text = z.string().nullable().optional()

/** A pickup address in Medusa's columns; the country's form decides which are required (`@oja/domain`). */
export const VendorSavePickupAddress = z.object({
  first_name: text,
  last_name: text,
  address_1: text,
  address_2: text,
  city: text,
  province: text,
  postal_code: text,
  phone: text,
  country_code: z.string().length(2),
  metadata: z
    .object({
      landmark: text,
      /** The pin the owner confirmed on the map (#41); Shipbubble then validates by it. */
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional(),
    })
    .optional(),
})
export type VendorSavePickupAddressType = z.infer<typeof VendorSavePickupAddress>
