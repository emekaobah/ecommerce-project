import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { createImportedOfferWorkflow } from "../../workflows/offer-import/create-imported-offer"
import { updateImportedOfferWorkflow } from "../../workflows/offer-import/update-imported-offer"
import { suppliedFields } from "../catalogue-import"
import { errorMessage } from "../errors"
import { planOfferUpdate, type ShopSetup } from "./load"
import type { OfferImportRow, OfferUpdate } from "./rows"

export type OfferImportResult = {
  row: number
  title: string | null
  /**
   * `offered`: the shop now sells a catalogue product; `proposed`: a new product
   * went to review, offered by the shop; `updated`: the shop's existing offer took
   * the row's changes; `unchanged`: it already matched the row; `skipped`: the row
   * had errors; `failed`: the catalogue refused it, and nothing of the row was kept.
   */
  status: "offered" | "proposed" | "updated" | "unchanged" | "skipped" | "failed"
  offer_id: string | null
  product_id: string | null
  errors: string[]
  warnings: string[]
  /** What an update changed. */
  changes: string[]
}

type ImportOptions = { seller_id: string; member_id: string; setup: ShopSetup }

/**
 * Imports each valid row, one at a time and independently, each all or nothing
 * (createImportedOfferWorkflow). A matched row becomes the shop's offer at once
 * (offers on catalogue products need no review). Any other row is proposed as a
 * new product, created by the shop as its own vendor proposals are, queued for
 * enrichment as a vendor's (so it goes to the admin queue unless a trusted source
 * vouches for it), and offered by the shop. The cost price is kept apart from the
 * offer, private to the shop's owner and managers; a sale price goes in the shop's
 * price lists, kept to its own offer.
 */
export async function importOfferRows(
  scope: MedusaContainer,
  rows: OfferImportRow[],
  { seller_id, member_id, setup }: ImportOptions
): Promise<OfferImportResult[]> {
  // Checked before anything is created, rather than failing every row.
  const shippingProfileId = setup.shipping_profile_id
  if (!shippingProfileId) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "The shop has no shipping profile for its offers yet.")
  }

  const results: OfferImportResult[] = []
  // One row at a time: rows on one product would race to link its single shipping profile.
  for (const row of rows) {
    const base = { row: row.row, title: row.title, errors: row.errors, warnings: [...row.warnings], changes: row.changes }
    if (row.update) {
      results.push(await updateRow(scope, row.update, row.action === "update", { seller_id, setup }, base))
      continue
    }
    if (!row.offer) {
      results.push({ ...base, status: "skipped", offer_id: null, product_id: null })
      continue
    }
    let stock = row.offer.stock
    if (stock !== null && !setup.stock_location_id) {
      base.warnings.push("Stock not recorded: the shop has no stock location yet.")
      stock = null
    }
    try {
      const { result } = await createImportedOfferWorkflow(scope).run({
        input: {
          seller_id,
          member_id,
          currency_code: setup.currency_code,
          shipping_profile_id: shippingProfileId,
          stock_location_id: setup.stock_location_id,
          sales_channel_id: setup.sales_channel_id,
          proposal: row.proposal,
          supplied: row.proposal ? suppliedFields(row.proposal) : [],
          variant_id: row.offer.variant_id,
          sku: row.offer.sku,
          price: row.offer.price,
          sale: row.offer.sale,
          cost: row.offer.cost,
          stock,
        },
      })
      results.push({ ...base, status: row.proposal ? "proposed" : "offered", offer_id: result.id, product_id: result.product_id })
    } catch (error) {
      results.push({ ...base, status: "failed", offer_id: null, product_id: null, errors: [errorMessage(error)] })
    }
  }
  return results
}

type ResultBase = Pick<OfferImportResult, "row" | "title" | "errors" | "warnings" | "changes">

/** Applies a re-imported row to the shop's offer, all or nothing; a row that changes nothing writes nothing. */
async function updateRow(
  scope: MedusaContainer,
  update: OfferUpdate,
  changed: boolean,
  { seller_id, setup }: Pick<ImportOptions, "seller_id" | "setup">,
  base: ResultBase
): Promise<OfferImportResult> {
  const done = { ...base, offer_id: update.offer_id, product_id: null }
  if (!changed) return { ...done, status: "unchanged" }
  try {
    const plan = await planOfferUpdate(scope, update, setup)
    await updateImportedOfferWorkflow(scope).run({
      input: { offer_id: update.offer_id, seller_id, currency_code: setup.currency_code, cost: update.cost, sale: update.sale, ...plan },
    })
    return { ...done, status: "updated" }
  } catch (error) {
    return { ...done, status: "failed", errors: [errorMessage(error)] }
  }
}

export function summariseOfferImport(results: OfferImportResult[]) {
  const count = (status: OfferImportResult["status"]) => results.filter((r) => r.status === status).length
  return {
    total: results.length,
    offered: count("offered"),
    updated: count("updated"),
    unchanged: count("unchanged"),
    proposed: count("proposed"),
    skipped: count("skipped"),
    failed: count("failed"),
  }
}
