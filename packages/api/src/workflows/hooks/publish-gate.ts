import type { MedusaContainer, ProductDTO } from "@medusajs/framework/types"
import { StepResponse } from "@medusajs/framework/workflows-sdk"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import {
  confirmProductChangeWorkflow,
  confirmProductsWorkflow,
  createProductsWorkflow,
} from "@mercurjs/core/workflows"
import { assertPublishable, loadPendingActions } from "../../lib/product-completeness"
import {
  applyCategoryShippingDefaults,
  restoreShippingFields,
  type ShippingDefaultsUpdate,
} from "../../lib/shipping-defaults"

// The publish gate: no product becomes, or stays, published while incomplete.
// Where a workflow offers a hook before it writes, the gate refuses there; the
// hooks after a write throw to roll the workflow back.

// Mercur's published typings drop this workflow's hooks; the hook exists at runtime.
type Context = { container: MedusaContainer }
type ProductsCreatedHook = (
  handler: (input: { products: ProductDTO[] }, context: Context) => Promise<StepResponse<void, ShippingDefaultsUpdate[]>>,
  compensate: (previous: ShippingDefaultsUpdate[] | undefined, context: Context) => Promise<void>
) => void
const { productsCreated } = createProductsWorkflow.hooks as unknown as { productsCreated: ProductsCreatedHook }

/**
 * Fills the products' blank shipping fields from their categories, then runs the
 * gate. A failing hook step gets no compensation of its own, so a refusal undoes
 * the fill here before it propagates.
 */
async function fillDefaultsThenGate(container: MedusaContainer, ids: string[]) {
  const previous = await applyCategoryShippingDefaults(container, ids)
  try {
    await assertPublishable(container, ids, { onlyIfPublished: true })
  } catch (error) {
    await restoreShippingFields(container, previous)
    throw error
  }
  return new StepResponse(undefined, previous)
}

const undoFill = async (previous: ShippingDefaultsUpdate[] | undefined, { container }: Context) =>
  restoreShippingFields(container, previous)

// New products take their category's shipping defaults, then face the gate if
// they were created as published (a rollback deletes them).
productsCreated(async ({ products }, { container }) => fillDefaultsThenGate(container, products.map((p) => p.id)), undoFill)

// Every product save: operator edits and status changes, the admin batch
// endpoint, and applied vendor change requests (which run this workflow). A
// product that gains a category takes its defaults for fields still blank; the
// gate then refuses a save that leaves a product published but incomplete.
updateProductsWorkflow.hooks.productsUpdated(
  async ({ products }, { container }) => fillDefaultsThenGate(container, products.map((p) => p.id)),
  undoFill
)

// The operator approving a proposed product.
confirmProductsWorkflow.hooks.productsConfirmed(async ({ product_ids }, { container }) => {
  await assertPublishable(container, product_ids)
})

// A vendor's change request (edit, status change) being applied. Checked against
// the product as it will be once the change applies, before anything is written:
// rolling back an applied change would not restore every relation it touched.
confirmProductChangeWorkflow.hooks.validate(async ({ input }, { container }) => {
  const pending = await loadPendingActions(container, input.ids)
  await assertPublishable(container, [...pending.keys()], { pending, onlyIfPublished: true })
})
