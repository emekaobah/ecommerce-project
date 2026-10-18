import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { SEED_PASSWORD, SEED_SELLERS } from "../../src/scripts/seed-data"
import { vendorHeaders } from "./auth"

type Api = { post: (url: string, body?: unknown, config?: unknown) => Promise<{ data: any }> }

/** Request config for the seeded grocery shop's owner. */
export async function groceryVendor(container: MedusaContainer, api: Api) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const shop = SEED_SELLERS[0]
  const { data: [seller] } = await query.graph({ entity: "seller", fields: ["id"], filters: { email: shop.owner.email } })
  return vendorHeaders(api, shop.owner.email, SEED_PASSWORD, seller.id)
}

/** The grocery shop lists every variant of the product at ₦3,500. */
export async function offerOn(container: MedusaContainer, api: Api, product: { id: string }) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: [profile] } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
    filters: { name: "Marketplace Shipping" },
  })
  const { data: [full] } = await query.graph({ entity: "product", fields: ["variants.id"], filters: { id: product.id } })
  const vendor = await groceryVendor(container, api)
  // One variant at a time: offers on one product race to link its shipping profile (lib/offer-import).
  for (const variant of full.variants as { id: string }[]) {
    const sku = `OFFER-${variant.id}`
    await api.post(
      "/vendor/offers",
      {
        sku,
        variant_id: variant.id,
        shipping_profile_id: profile.id,
        inventory_items: [{ sku }],
        prices: [{ amount: 3500, currency_code: "ngn" }],
      },
      vendor
    )
  }
}
