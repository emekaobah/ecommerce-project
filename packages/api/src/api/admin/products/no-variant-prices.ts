import type { MedusaNextFunction, MedusaRequest, MedusaResponse, MiddlewareRoute } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { parseCsv } from "../../../lib/catalogue-import/csv"

const REFUSAL =
  "A variant's prices can't be set here: offer prices are set per shop, on its offer (POST /vendor/offers/:id), or with price lists."

type Body = Record<string, unknown>

const list = (value: unknown): Body[] => (Array.isArray(value) ? value.filter((v) => v && typeof v === "object") : [])
const variantsOf = (product: Body) => list(product.variants)
const batchOf = (body: Body) => [...list(body.create), ...list(body.update)]

/**
 * Refuses (400) a body whose variants, picked out of it by `variants`, carry `prices`.
 *
 * Offers of a variant share its price set, told apart by an `offer_id` price rule. Medusa
 * writes a variant's `prices` as the set's whole list, deleting every shop's offer prices for
 * it; and a price without an `offer_id` rule fills any offer's gap in that currency, so even on
 * create it would price offers the shop never priced (#15).
 */
function refuseVariantPricesIn(variants: (body: Body) => Body[]) {
  return (req: MedusaRequest, _res: MedusaResponse, next: MedusaNextFunction) => {
    const body = (req.body ?? {}) as Body
    if (variants(body).some((variant) => "prices" in variant)) {
      return next(new MedusaError(MedusaError.Types.INVALID_DATA, REFUSAL))
    }
    next()
  }
}

/** Whether a Medusa product CSV sets any variant price: a "Variant Price …" column with a value. */
function csvSetsVariantPrices(csv: string) {
  const { headers, rows } = parseCsv(csv)
  const priceColumns = headers.flatMap((header, i) => (header.toLowerCase().startsWith("variant price ") ? [i] : []))
  return rows.some((row) => priceColumns.some((i) => row[i]))
}

/** Refuses (400) a product import whose CSV, read from the file module, sets variant prices. */
async function refuseImportedVariantPrices(req: MedusaRequest, _res: MedusaResponse, next: MedusaNextFunction) {
  try {
    const fileKey = ((req.body ?? {}) as Body).file_key
    if (typeof fileKey !== "string") return next()
    const csv = (await req.scope.resolve(Modules.FILE).getAsBuffer(fileKey)).toString("utf-8")
    if (csvSetsVariantPrices(csv)) return next(new MedusaError(MedusaError.Types.INVALID_DATA, REFUSAL))
    next()
  } catch (error) {
    next(error)
  }
}

/**
 * Medusa's deprecated upload import. Its file is read by a middleware that can't be relied on
 * to run before ours, so the sheet's prices can't be checked: it is refused for the newer import.
 */
function refuseUploadImport(_req: MedusaRequest, _res: MedusaResponse, next: MedusaNextFunction) {
  next(
    new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Products are imported with POST /admin/products/imports, which checks the sheet for variant prices."
    )
  )
}

/** Every operator route that writes a variant's prices, refusing them (#15). */
export const adminVariantPriceMiddlewares: MiddlewareRoute[] = [
  { method: ["POST"], matcher: "/admin/products", middlewares: [refuseVariantPricesIn(variantsOf)] },
  {
    method: ["POST"],
    matcher: "/admin/products/batch",
    middlewares: [refuseVariantPricesIn((body) => batchOf(body).flatMap(variantsOf))],
  },
  { method: ["POST"], matcher: "/admin/products/:id", middlewares: [refuseVariantPricesIn(variantsOf)] },
  { method: ["POST"], matcher: "/admin/products/:id/variants", middlewares: [refuseVariantPricesIn((body) => [body])] },
  { method: ["POST"], matcher: "/admin/products/:id/variants/batch", middlewares: [refuseVariantPricesIn(batchOf)] },
  {
    method: ["POST"],
    matcher: "/admin/products/:id/variants/:variant_id",
    middlewares: [refuseVariantPricesIn((body) => [body])],
  },
  { method: ["POST"], matcher: "/admin/products/import", middlewares: [refuseUploadImport] },
  { method: ["POST"], matcher: "/admin/products/imports", middlewares: [refuseImportedVariantPrices] },
]
