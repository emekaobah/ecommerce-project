import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules, ProductStatus } from "@medusajs/framework/utils"
import { createImportedOfferWorkflow } from "../../workflows/offer-import/create-imported-offer"
import type { EnrichableField } from "../enrichment"
import { loadShopSetup } from "../offer-import"
import type { ProposedProduct } from "../offer-import/rows"
import { readScannedBarcode } from "./barcode"

type Scope = Pick<MedusaContainer, "resolve">

/** How an offer was added, kept in its metadata, so the owner can find what staff quick-added. */
export const QUICK_ADD_METADATA = { added_with: "quick_add" } as const

/** A quick-add photo: product shots only, at most 10 MB. */
export const PHOTO_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
])
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024

export type QuickAddLookup = {
  /** The barcode as read. */
  barcode: string
  currency_code: string
  /** The catalogue product the barcode names, or null when the catalogue doesn't have it. */
  product: {
    id: string
    variant_id: string
    title: string
    thumbnail: string | null
    /** Still in the catalogue's review: it takes offers once published. */
    in_review: boolean
  } | null
  /** The shop's own offer on it, when it already sells it. */
  offer: { id: string; price: number | null; stock: number | null } | null
}

type VariantRow = {
  id: string
  product: { id: string; title: string; thumbnail: string | null; status: string } | null
}

type OfferRow = {
  id: string
  manage_inventory: boolean
  prices?: ({ amount: number; currency_code: string; min_quantity: number | null; max_quantity: number | null } | null)[] | null
  inventory_items?: { location_levels?: { stocked_quantity: number }[] | null }[] | null
}

function readOrRefuse(scanned: string) {
  const read = readScannedBarcode(scanned)
  if (!read.ok) throw new MedusaError(MedusaError.Types.INVALID_DATA, read.error)
  return read
}

/** The catalogue variant carrying any of the codes in its barcode, EAN or UPC. */
async function variantByCodes(scope: Scope, codes: string[]): Promise<VariantRow | null> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const fields = ["id", "product.id", "product.title", "product.thumbnail", "product.status"]
  for (const field of ["barcode", "ean", "upc"] as const) {
    const { data } = await query.graph({ entity: "product_variant", fields, filters: { [field]: codes } })
    // A rejected proposal stays in the catalogue, but can never be sold.
    const found = (data as VariantRow[]).find((v) => v.product && v.product.status !== ProductStatus.REJECTED)
    if (found) return found
  }
  return null
}

async function shopOfferOn(scope: Scope, sellerId: string, variantId: string, currency: string) {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "offer",
    fields: [
      "id",
      "manage_inventory",
      "prices.amount",
      "prices.currency_code",
      "prices.min_quantity",
      "prices.max_quantity",
      "inventory_items.location_levels.stocked_quantity",
    ],
    filters: { seller_id: sellerId, variant_id: variantId },
  })
  const offer = (data as OfferRow[])[0]
  if (!offer) return null
  const price = offer.prices?.find((p) => p?.currency_code === currency && p.min_quantity == null && p.max_quantity == null)
  const levels = offer.inventory_items?.flatMap((i) => i.location_levels ?? []) ?? []
  return {
    id: offer.id,
    price: price ? Number(price.amount) : null,
    stock: offer.manage_inventory ? levels.reduce((sum, l) => sum + Number(l.stocked_quantity), 0) : null,
  }
}

/** A scan read against the catalogue for a shop, with the shop's setup it was read in. */
async function lookUp(scope: Scope, sellerId: string, scanned: string) {
  const read = readOrRefuse(scanned)
  const setup = await loadShopSetup(scope, sellerId)
  const { currency_code } = setup
  const variant = await variantByCodes(scope, read.lookup)
  const lookup: QuickAddLookup = { barcode: read.barcode.barcode, currency_code, product: null, offer: null }
  if (variant?.product) {
    lookup.product = {
      id: variant.product.id,
      variant_id: variant.id,
      title: variant.product.title,
      thumbnail: variant.product.thumbnail,
      in_review: variant.product.status !== ProductStatus.PUBLISHED,
    }
    lookup.offer = await shopOfferOn(scope, sellerId, variant.id, currency_code)
  }
  return { read, setup, lookup }
}

/** What a scanned barcode is to the shop: a catalogue product it sells, one it could sell, or one to propose. */
export async function lookUpBarcode(scope: Scope, sellerId: string, scanned: string): Promise<QuickAddLookup> {
  return (await lookUp(scope, sellerId, scanned)).lookup
}

export type QuickAddInput = {
  barcode: string
  /** Selling price, in major units. */
  price: number
  /** Units in stock; null or left out leaves the offer untracked. */
  stock?: number | null
  /** Needed for a product the catalogue lacks. */
  title?: string
  /** The product's photo, needed for a product the catalogue lacks. */
  photo?: { mime_type: string; data: string }
}

export type QuickAddResult = {
  /** `offered`: the shop now sells a catalogue product; `proposed`: a new product went to review, offered by the shop. */
  result: "offered" | "proposed"
  offer_id: string
  product_id: string
}

/** A SKU for the shop's new offer: the barcode, numbered if the shop already uses it. */
async function freeSku(scope: Scope, sellerId: string, base: string) {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "offer", fields: ["sku"], filters: { seller_id: sellerId } })
  const taken = new Set((data as { sku: string }[]).map((o) => o.sku))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/** The file extension a quick-add photo of this type is stored with; undefined for any other type. */
export const photoExtension = (mimeType: string) => PHOTO_TYPES.get(mimeType)
export const PHOTO_TYPE_ERROR = "The photo must be a JPEG, PNG or WebP image."

/** Stores the photo in our file storage (R2 in production). */
async function storePhoto(scope: Scope, photo: NonNullable<QuickAddInput["photo"]>) {
  const extension = photoExtension(photo.mime_type)
  if (!extension) throw new MedusaError(MedusaError.Types.INVALID_DATA, PHOTO_TYPE_ERROR)
  // Some cameras wrap their base64 in lines; file providers take it unwrapped.
  const content = photo.data.replace(/\s/g, "")
  const bytes = Buffer.from(content, "base64")
  if (!bytes.length) throw new MedusaError(MedusaError.Types.INVALID_DATA, "The photo is empty.")
  if (bytes.length > MAX_PHOTO_BYTES) throw new MedusaError(MedusaError.Types.INVALID_DATA, "The photo is larger than 10 MB.")
  const [file] = await scope.resolve(Modules.FILE).createFiles([
    { filename: `quick-add.${extension}`, mimeType: photo.mime_type, content, access: "public" },
  ])
  return file
}

/**
 * Quick-add (#38, ADR 0006): a member adds a scanned product the shop doesn't sell
 * yet. A barcode the catalogue has becomes the shop's offer at the member's price
 * and stock; one it lacks is proposed with the member's photo and name (queued for
 * enrichment as a vendor's, so it reaches the admin queue) and offered. Either way
 * the offer records the member who added it. It never changes an offer the shop
 * already has: that stays with owners and managers.
 */
export function quickAdd(scope: MedusaContainer, actor: QuickAddActor, input: QuickAddInput): Promise<QuickAddResult> {
  const read = readOrRefuse(input.barcode)
  // One quick-add of a barcode at a time, across shops: two phones scanning the same item
  // would otherwise both find no offer and add two, or propose the product twice.
  const key = `quick-add:${read.lookup.at(-1)}`
  return scope.resolve(Modules.LOCKING).execute(key, () => addOnce(scope, actor, input))
}

/** Who quick-adds: the shop, and the member acting for it. */
export type QuickAddActor = { seller_id: string; member_id: string }

async function addOnce(scope: MedusaContainer, { seller_id, member_id }: QuickAddActor, input: QuickAddInput): Promise<QuickAddResult> {
  const { read, setup, lookup } = await lookUp(scope, seller_id, input.barcode)
  if (lookup.product && lookup.offer) {
    throw new MedusaError(
      MedusaError.Types.DUPLICATE_ERROR,
      `Your shop already sells ${lookup.product.title}. Only owners and managers can change its price or stock, in the web vendor panel.`
    )
  }
  if (lookup.product?.in_review) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `${lookup.product.title} is still being reviewed for the catalogue. Add it once it is approved.`
    )
  }
  const title = input.title?.trim()
  const photo = input.photo
  if (!lookup.product && (!title || !photo)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "The catalogue doesn't have this barcode: add a photo and the product's name.")
  }
  const shippingProfileId = setup.shipping_profile_id
  if (!shippingProfileId) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "The shop has no shipping profile for its offers yet.")
  }
  const stock = input.stock ?? null
  if (stock !== null && !setup.stock_location_id) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "The shop has no stock location to count stock at.")
  }

  let proposal: ProposedProduct | null = null
  let storedPhoto: { id: string; url: string } | null = null
  let supplied: EnrichableField[] = []
  if (!lookup.product && title && photo) {
    storedPhoto = await storePhoto(scope, photo)
    const { url } = storedPhoto
    proposal = { title, thumbnail: url, images: [{ url }], variants: [{ title, ...read.barcode }] }
    supplied = ["title", "images"]
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
        proposal,
        supplied,
        stored_images: storedPhoto ? [storedPhoto.url] : [],
        variant_id: lookup.product?.variant_id ?? null,
        sku: await freeSku(scope, seller_id, read.barcode.barcode),
        price: input.price,
        cost: null,
        stock,
        metadata: { ...QUICK_ADD_METADATA },
      },
    })
    return { result: proposal ? "proposed" : "offered", offer_id: result.id, product_id: result.product_id }
  } catch (error) {
    // Nothing of a failed quick-add is kept, its photo included.
    if (storedPhoto) await scope.resolve(Modules.FILE).deleteFiles(storedPhoto.id)
    throw error
  }
}
