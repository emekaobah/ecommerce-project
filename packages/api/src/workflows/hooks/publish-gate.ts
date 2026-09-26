import type { MedusaContainer, ProductDTO } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import {
  confirmProductChangeWorkflow,
  confirmProductsWorkflow,
  createProductsWorkflow,
} from "@mercurjs/core/workflows"
import { assertPublishable, type PendingAction } from "../../lib/product-completeness"
import { applyCategoryShippingDefaults } from "../../lib/shipping-defaults"

// The publish gate: no product becomes, or stays, published while incomplete.
// Where a workflow offers a hook before it writes, the gate refuses there; the
// hooks after a write throw to roll the workflow back.

// Mercur's published typings drop this workflow's hooks; the hook exists at runtime.
type ProductsCreatedHook = (
  handler: (input: { products: ProductDTO[] }, context: { container: MedusaContainer }) => Promise<void>
) => void
const { productsCreated } = createProductsWorkflow.hooks as unknown as { productsCreated: ProductsCreatedHook }

// New products first take their category's shipping defaults, then face the gate
// if they were created as published (a rollback deletes them).
productsCreated(async ({ products }, { container }) => {
  const ids = products.map((p) => p.id)
  await applyCategoryShippingDefaults(container, ids)
  await assertPublishable(container, ids, { onlyIfPublished: true })
})

// Operator edits and status changes (POST /admin/products/:id), and any other
// save that leaves a product published.
updateProductsWorkflow.hooks.productsUpdated(async ({ products }, { container }) => {
  await assertPublishable(
    container,
    products.map((p) => p.id),
    { onlyIfPublished: true }
  )
})

// The operator approving a proposed product.
confirmProductsWorkflow.hooks.productsConfirmed(async ({ product_ids }, { container }) => {
  await assertPublishable(container, product_ids)
})

// A vendor's change request (edit, status change) being applied. Checked against
// the product as it will be once the change applies, before anything is written:
// rolling back an applied change would not restore every relation it touched.
confirmProductChangeWorkflow.hooks.validate(async ({ input }, { container }) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_change_action",
    fields: ["product_id", "action", "details", "ordering"],
    filters: { product_change_id: input.ids, applied: false } as any,
  })
  const rows = (data as (PendingAction & { product_id: string; ordering: number })[]).sort(
    (a, b) => a.ordering - b.ordering
  )
  const pending = new Map<string, PendingAction[]>()
  for (const row of rows) {
    pending.set(row.product_id, [...(pending.get(row.product_id) ?? []), row])
  }
  await assertPublishable(container, [...pending.keys()], { pending, onlyIfPublished: true })
})
