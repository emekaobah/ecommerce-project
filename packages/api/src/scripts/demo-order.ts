import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createOrderWorkflow } from "@medusajs/medusa/core-flows"
import { MercurModules } from "@mercurjs/types"
import { SEED_PRODUCTS, SEED_SELLERS } from "./seed-data"

/**
 * Places a new, unpaid order with a seeded shop, for working an order through the vendor app
 * (accept, pick, pack) without a buyer checking out with Paystack. Development only.
 *
 *   bun run --cwd packages/api demo:order [shop name]   (default: the grocery shop)
 *
 * The order is two of the shop's first product and one of its second, so the pick list has a
 * line to pick twice. Its money isn't real: there is no payment, so don't reject it.
 */
export default async function placeDemoOrder({ container, args }: ExecArgs) {
  const shopName = args[0] ?? SEED_SELLERS[0].name
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const { data: sellers } = await query.graph({ entity: "seller", fields: ["id"], filters: { name: shopName } })
  if (!sellers[0]) throw new Error(`No shop named "${shopName}". Run the seed first.`)
  const sellerId = sellers[0].id as string

  const { data: offers } = await query.graph({
    entity: "offer",
    fields: ["id", "variant_id", "product_id"],
    filters: { seller_id: sellerId },
  })
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "thumbnail", "variants.id", "variants.title"],
    filters: { id: offers.map((o: { product_id: string }) => o.product_id) },
  })
  // Single-variant seed products, in seed order, so the lines are the same each time.
  const lines = SEED_PRODUCTS.filter((p) => !p.sized)
    .map((seeded) => ({ seeded, product: products.find((p: { title: string }) => p.title === seeded.title) }))
    .filter((line) => line.product)
    .slice(0, 2)
  if (lines.length < 2) throw new Error(`"${shopName}" doesn't sell two single-variant products.`)

  const { data: regions } = await query.graph({ entity: "region", fields: ["id", "currency_code"] })
  const region = regions[0]
  const { result: order } = await createOrderWorkflow(container).run({
    input: {
      region_id: region.id,
      currency_code: region.currency_code,
      email: "ada@oja.test",
      shipping_address: {
        first_name: "Ada",
        last_name: "Obi",
        address_1: "3 Akin Adesola Street",
        city: "Eti-Osa",
        province: "Lagos",
        country_code: "ng",
        phone: "+2348031234567",
      },
      items: lines.map(({ seeded, product }, i) => {
        const variant = product!.variants[0]!
        return {
          title: variant.title,
          product_title: product!.title,
          variant_id: variant.id,
          thumbnail: product!.thumbnail ?? undefined,
          quantity: i === 0 ? 2 : 1,
          unit_price: seeded.price,
          // Shop prices include VAT, as offer prices do.
          is_tax_inclusive: true,
        }
      }),
    },
  })

  await container.resolve(ContainerRegistrationKeys.LINK).create({
    [Modules.ORDER]: { order_id: order.id },
    [MercurModules.SELLER]: { seller_id: sellerId },
  })
  logger.info(`Placed order #${order.display_id} (${order.id}) with ${shopName}`)
}
