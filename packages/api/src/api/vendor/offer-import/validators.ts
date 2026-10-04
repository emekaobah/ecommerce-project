import { z } from "@medusajs/framework/zod"

const Mapping = z.record(z.string(), z.string())

export const VendorPreviewOfferImport = z.object({
  csv: z.string().min(1),
  /** Column → field. Omitted, the shop's saved mapping (or a suggestion) is used. */
  mapping: Mapping.optional(),
})

export const VendorRunOfferImport = z.object({
  csv: z.string().min(1),
  mapping: Mapping,
})

export const VendorGetOfferCosts = z.object({
  offer_id: z.union([z.string(), z.array(z.string())]).optional(),
})

export type VendorPreviewOfferImportType = z.infer<typeof VendorPreviewOfferImport>
export type VendorRunOfferImportType = z.infer<typeof VendorRunOfferImport>
export type VendorGetOfferCostsType = z.infer<typeof VendorGetOfferCosts>
