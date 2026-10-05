import { model } from "@medusajs/framework/utils"

/**
 * The bank account a shop is paid into (#26): one per shop, resolved with Paystack to its
 * holder's name and registered as a Paystack transfer recipient, which payouts pay (#29).
 * Kept here rather than in Mercur's seller payment details, which any member with the seller
 * update permission can write without Paystack checking the account.
 */
const ShopBankAccount = model.define("shop_bank_account", {
  id: model.id({ prefix: "sbank" }).primaryKey(),
  seller_id: model.text().unique(),
  currency_code: model.text(),
  /** Paystack's code for the bank, e.g. "058". */
  bank_code: model.text(),
  bank_name: model.text(),
  account_number: model.text(),
  /** The holder's name as the bank has it, which Paystack resolved. */
  account_name: model.text(),
  /** Paystack's transfer recipient for the account (`RCP_…`). */
  recipient_code: model.text(),
})

export default ShopBankAccount
