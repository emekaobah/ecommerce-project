import { z } from "@medusajs/framework/zod"

const Mapping = z.record(z.string(), z.string())

export const AdminPreviewCatalogueImport = z.object({
  csv: z.string().min(1),
  /** Who the sheet comes from; a saved mapping for it is reused. */
  source: z.string().trim().min(1).optional(),
  /** Column → field. Omitted, the source's saved mapping (or a suggestion) is used. */
  mapping: Mapping.optional(),
})

export const AdminRunCatalogueImport = z.object({
  csv: z.string().min(1),
  source: z.string().trim().min(1),
  mapping: Mapping,
})

export type AdminPreviewCatalogueImportType = z.infer<typeof AdminPreviewCatalogueImport>
export type AdminRunCatalogueImportType = z.infer<typeof AdminRunCatalogueImport>
