import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { SHOP_BANK_ACCOUNT_MODULE, type ShopBankAccountModuleService } from "../../modules/shop-bank-account"

export type ShopBankAccountInput = {
  seller_id: string
  currency_code: string
  bank_code: string
  bank_name: string
  account_number: string
  account_name: string
  recipient_code: string
}

type Saved = ShopBankAccountInput & { id: string }

/** Sets the shop's bank account, replacing the one it had; undone by putting that one back. */
const saveShopBankAccountStep = createStep(
  "save-shop-bank-account-step",
  async (input: ShopBankAccountInput, { container }) => {
    const service = container.resolve<ShopBankAccountModuleService>(SHOP_BANK_ACCOUNT_MODULE)
    const [previous] = await service.listShopBankAccounts({ seller_id: input.seller_id })
    const saved = previous
      ? await service.updateShopBankAccounts({ id: previous.id, ...input })
      : await service.createShopBankAccounts(input)
    return new StepResponse(saved as Saved, { previous: (previous as Saved | undefined) ?? null, id: saved.id })
  },
  async (undo, { container }) => {
    if (!undo) return
    const service = container.resolve<ShopBankAccountModuleService>(SHOP_BANK_ACCOUNT_MODULE)
    if (undo.previous) await service.updateShopBankAccounts(undo.previous)
    else await service.deleteShopBankAccounts(undo.id)
  }
)

/** Records the bank account a shop is paid into, once Paystack has resolved it (#26). */
export const saveShopBankAccountWorkflow = createWorkflow(
  "save-shop-bank-account",
  (input: ShopBankAccountInput) => new WorkflowResponse(saveShopBankAccountStep(input))
)
