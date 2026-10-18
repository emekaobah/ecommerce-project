import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"

// The cap on what the platform pays above the buyer's checkout price for a courier label (#19):
// a flat amount per shipment, kept in the store's metadata and set by Oja's team in the admin.

type Scope = Pick<MedusaContainer, "resolve">

const TOP_UP_CAP_KEY = "courier_top_up_cap"
/** The cap until Oja's team set one: ₦1,000 per shipment. */
const DEFAULT_TOP_UP_CAP = 1000

async function theStore(scope: Scope) {
  const [store] = await scope.resolve(Modules.STORE).listStores({}, { select: ["id", "metadata"], take: 1 })
  if (!store) throw new MedusaError(MedusaError.Types.NOT_FOUND, "The store isn't set up")
  return store
}

/** The top-up cap Oja's team set, or the default. */
export async function topUpCap(scope: Scope): Promise<number> {
  const cap = (await theStore(scope)).metadata?.[TOP_UP_CAP_KEY]
  return typeof cap === "number" ? cap : DEFAULT_TOP_UP_CAP
}

/** Sets the top-up cap: a flat amount per shipment, in the store's currency. */
export async function setTopUpCap(scope: Scope, cap: number): Promise<number> {
  const store = await theStore(scope)
  await scope.resolve(Modules.STORE).updateStores(store.id, { metadata: { ...store.metadata, [TOP_UP_CAP_KEY]: cap } })
  return cap
}
