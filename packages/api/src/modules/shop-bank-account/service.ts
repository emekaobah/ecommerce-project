import { MedusaService } from "@medusajs/framework/utils"
import ShopBankAccount from "./models/shop-bank-account"

class ShopBankAccountModuleService extends MedusaService({ ShopBankAccount }) {}

export default ShopBankAccountModuleService
