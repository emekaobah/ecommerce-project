import { ModuleProvider } from "@medusajs/framework/utils"
import { MercurModules } from "@mercurjs/types"
import { PaystackPayoutProviderService } from "./service"

export { PaystackPayoutProviderService }

export default ModuleProvider(MercurModules.PAYOUT, {
  services: [PaystackPayoutProviderService],
})
