import { z } from "@medusajs/framework/zod"
import { PHOTO_TYPES } from "../../../lib/quick-add"

export const VendorQuickAdd = z.object({
  barcode: z.string().min(1),
  /** Selling price, in major units. */
  price: z.number().positive(),
  /** Units in stock; null or left out leaves the offer untracked. */
  stock: z.number().int().min(0).nullish(),
  /** The product's name, for a barcode the catalogue lacks. */
  title: z.string().trim().min(1).max(200).optional(),
  /** The product's photo, base64-encoded, for a barcode the catalogue lacks. */
  photo: z
    .object({
      mime_type: z.string().refine((type) => type in PHOTO_TYPES, "The photo must be a JPEG, PNG or WebP image."),
      data: z.string().min(1),
    })
    .optional(),
})

export type VendorQuickAddType = z.infer<typeof VendorQuickAdd>

export const VendorGetOfferAuthors = z.object({ product_id: z.string().min(1) })

export type VendorGetOfferAuthorsType = z.infer<typeof VendorGetOfferAuthors>
