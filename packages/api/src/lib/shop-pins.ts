import type { MedusaContainer } from "@medusajs/framework/types"
import type { Pin } from "@oja/domain"
import { SHOP_PIN_MODULE, type ShopPinModuleService } from "../modules/shop-pin"

// The copy of each shop's pickup pin that listings rank by in SQL (ADR 0014). The pickup
// address's metadata stays the source; `workflows/hooks/shop-pin.ts` keeps this in step with it.

/** The shop's copied pin; null without one. */
export async function shopPinOf(scope: MedusaContainer, sellerId: string): Promise<Pin | null> {
  const [row] = await scope.resolve<ShopPinModuleService>(SHOP_PIN_MODULE).listShopPins({ seller_id: sellerId })
  return row ? { latitude: row.latitude, longitude: row.longitude } : null
}

/** Sets the shop's copied pin, or removes it when the pickup address has none. */
export async function setShopPin(scope: MedusaContainer, sellerId: string, pin: Pin | null): Promise<void> {
  const pins = scope.resolve<ShopPinModuleService>(SHOP_PIN_MODULE)
  const [row] = await pins.listShopPins({ seller_id: sellerId })
  if (!pin) {
    if (row) await pins.deleteShopPins(row.id)
    return
  }
  if (row) await pins.updateShopPins({ id: row.id, latitude: pin.latitude, longitude: pin.longitude })
  else await pins.createShopPins({ seller_id: sellerId, latitude: pin.latitude, longitude: pin.longitude })
}
