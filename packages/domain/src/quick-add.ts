/**
 * Quick-add (#38): staff scan a product the shop doesn't sell yet and add it. A
 * product the catalogue has needs only the shop's price (and stock, if counted);
 * one it lacks also needs a photo and the product's name.
 */

export type QuickAddFormInput = { price: string; stock: string; title?: string; hasPhoto?: boolean }

export type QuickAddFormValue = {
  /** Selling price, in major units. */
  price: number
  /** Units in stock; null leaves the offer untracked. */
  stock: number | null
  /** The product's name, for a product the catalogue lacks. */
  title?: string
}

export type QuickAddFormErrors = Partial<Record<"price" | "stock" | "title" | "photo", string>>

export type QuickAddFormResult = { ok: true; value: QuickAddFormValue } | { ok: false; errors: QuickAddFormErrors }

/** "2,500" or "1500.50"; thousands commas allowed. NaN when it isn't a plain amount. */
const amount = (text: string) => {
  const plain = text.trim().replaceAll(",", "")
  return /^\d+(\.\d+)?$/.test(plain) ? Number(plain) : Number.NaN
}

/** Reads what staff typed into the quick-add form, saying what to fix. */
export function quickAddForm(input: QuickAddFormInput, { newProduct }: { newProduct: boolean }): QuickAddFormResult {
  const errors: QuickAddFormErrors = {}

  const price = amount(input.price)
  if (!input.price.trim()) errors.price = "Enter a price."
  else if (!(price > 0)) errors.price = "Enter a price above zero."

  const stockText = input.stock.trim()
  const stock = stockText ? amount(stockText) : null
  if (stock !== null && !Number.isInteger(stock)) errors.stock = "Enter a whole number of items, or leave it empty."

  const title = input.title?.trim() ?? ""
  if (newProduct && !title) errors.title = "Enter the product's name."
  if (newProduct && !input.hasPhoto) errors.photo = "Take a photo of the product."

  if (Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, value: { price, stock, ...(newProduct ? { title } : {}) } }
}

/** The longest side, in pixels, a quick-add photo is shrunk to before upload. */
export const QUICK_ADD_PHOTO_MAX_SIDE = 1600

/**
 * The size to shrink a photo to so its longest side is at most `maxSide`, keeping its shape.
 * Null when it already fits, so a small photo isn't re-encoded for nothing.
 */
export function photoUploadSize(
  { width, height }: { width: number; height: number },
  maxSide = QUICK_ADD_PHOTO_MAX_SIDE,
): { width: number } | { height: number } | null {
  if (Math.max(width, height) <= maxSide) return null
  return width >= height ? { width: maxSide } : { height: maxSide }
}
