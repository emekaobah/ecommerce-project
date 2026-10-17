import { z } from "@medusajs/framework/zod"

/**
 * The bank account a buyer has a refund sent to (#13): a bank from the list and a 10-digit
 * account number (NUBAN). The messages never repeat what was entered.
 */
export const StoreRefundAccount = z.object({
  bank_code: z.string().trim().min(1, "Choose your bank"),
  account_number: z.string().trim().regex(/^\d{10}$/, "Enter the 10-digit account number"),
})
export type StoreRefundAccountType = z.infer<typeof StoreRefundAccount>
