import { readFile } from "node:fs/promises"
import path from "node:path"
import type { ExecArgs, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, toHandle } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import { updateSellersWorkflow } from "@mercurjs/core/workflows"
import { SEED_PRODUCTS, SEED_SELLERS, type SeedProduct } from "./seed-data"

/**
 * Puts the demo photos in demo-images/ on the seeded products and shops: each product's
 * gallery and thumbnail, each shop's logo and banner. The seed runs it on fresh databases;
 * on existing ones:
 *
 *   bun run --cwd packages/api demo:images
 *
 * The files go through the file module, so they land in ./static locally and in R2 where
 * S3_BUCKET is set. Only images change: never orders, prices or stock. A product or shop
 * already showing its demo photos is left alone, so re-running uploads nothing new.
 */
export default async function applyDemoImagesScript({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const { products, sellers } = await applyDemoImages(container)
  logger.info(
    `Demo images: ${products.updated} products and ${sellers.updated} shops updated, ` +
      `${products.current + sellers.current} already current.`
  )
  const missing = [...products.missing, ...sellers.missing]
  if (missing.length) logger.warn(`Not in this database, so skipped: ${missing.join(", ")}. Run the seed first.`)
}

const DEMO_IMAGES_DIR = path.join(__dirname, "demo-images")

/** A product's demo photos in gallery order; the first is its thumbnail. */
export function productPhotoFiles(product: Pick<SeedProduct, "title" | "photos">): string[] {
  const handle = toHandle(product.title)
  return Array.from({ length: product.photos }, (_, i) => (i === 0 ? `${handle}.jpg` : `${handle}-${i + 1}.jpg`))
}

/** A shop's demo logo and banner. */
export function shopImageFiles(shopName: string): { logo: string; banner: string } {
  const handle = toHandle(shopName)
  return { logo: `${handle}-logo.png`, banner: `${handle}-banner.png` }
}

// ULIDs in Crockford base32, as the S3 provider appends them.
const ULID = "[0-9A-HJKMNP-TV-Z]{26}"
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * Whether a stored file's URL is an upload of `filename`. The file providers keep the name in
 * the key: the local one as `<timestamp>-<name>.<ext>`, the S3 one (R2) as `<name>-<ulid>.<ext>`.
 */
export function isStoredCopy(url: string | null | undefined, filename: string): boolean {
  if (!url) return false
  let base: string
  try {
    base = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "")
  } catch {
    return false
  }
  const { name, ext } = path.parse(filename)
  const pattern = new RegExp(`^(?:\\d+-${escapeRegExp(name)}|${escapeRegExp(name)}-${ULID})${escapeRegExp(ext)}$`)
  return pattern.test(base)
}

/** Whether the stored URLs are uploads of exactly these files, in this order. */
export function areStoredCopies(urls: (string | null | undefined)[], files: string[]): boolean {
  return urls.length === files.length && files.every((file, i) => isStoredCopy(urls[i], file))
}

type Tally = { updated: number; current: number; missing: string[] }

export async function applyDemoImages(container: MedusaContainer): Promise<{ products: Tally; sellers: Tally }> {
  return {
    products: await applyProductPhotos(container),
    sellers: await applyShopImages(container),
  }
}

async function applyProductPhotos(container: MedusaContainer): Promise<Tally> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "handle", "thumbnail", "images.url", "images.rank"],
    filters: { handle: SEED_PRODUCTS.map((p) => toHandle(p.title)) },
  })
  const rows = data as unknown as {
    id: string
    handle: string
    thumbnail: string | null
    images: { url: string; rank: number }[] | null
  }[]
  const byHandle = new Map(rows.map((p) => [p.handle, p]))

  const tally: Tally = { updated: 0, current: 0, missing: [] }
  const updates: { id: string; thumbnail: string; images: { url: string }[] }[] = []
  for (const item of SEED_PRODUCTS) {
    const product = byHandle.get(toHandle(item.title))
    if (!product) {
      tally.missing.push(item.title)
      continue
    }
    const files = productPhotoFiles(item)
    const gallery = [...(product.images ?? [])].sort((a, b) => a.rank - b.rank).map((i) => i.url)
    if (isStoredCopy(product.thumbnail, files[0]) && areStoredCopies(gallery, files)) {
      tally.current++
      continue
    }
    const urls = await upload(container, files.map((file) => path.join("products", file)))
    updates.push({ id: product.id, thumbnail: urls[0], images: urls.map((url) => ({ url })) })
  }

  // As the operator, whose product edits apply directly (Mercur's admin product route does the same).
  if (updates.length) await updateProductsWorkflow(container).run({ input: { products: updates } })
  tally.updated = updates.length
  return tally
}

async function applyShopImages(container: MedusaContainer): Promise<Tally> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "seller",
    fields: ["id", "handle", "logo", "banner"],
    filters: { handle: SEED_SELLERS.map((s) => toHandle(s.name)) },
  })
  const rows = data as unknown as { id: string; handle: string; logo: string | null; banner: string | null }[]
  const byHandle = new Map(rows.map((s) => [s.handle, s]))

  const tally: Tally = { updated: 0, current: 0, missing: [] }
  for (const shop of SEED_SELLERS) {
    const seller = byHandle.get(toHandle(shop.name))
    if (!seller) {
      tally.missing.push(shop.name)
      continue
    }
    const { logo, banner } = shopImageFiles(shop.name)
    if (isStoredCopy(seller.logo, logo) && isStoredCopy(seller.banner, banner)) {
      tally.current++
      continue
    }
    const [logoUrl, bannerUrl] = await upload(container, [path.join("shops", logo), path.join("shops", banner)])
    await updateSellersWorkflow(container).run({
      input: { selector: { id: seller.id }, update: { logo: logoUrl, banner: bannerUrl } },
    })
    tally.updated++
  }
  return tally
}

const MIME_TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".png": "image/png" }

/** Uploads demo-images files through the file module; returns their public URLs in order. */
async function upload(container: MedusaContainer, files: string[]): Promise<string[]> {
  const stored = await container.resolve(Modules.FILE).createFiles(
    await Promise.all(
      files.map(async (file) => ({
        filename: path.basename(file),
        mimeType: MIME_TYPES[path.extname(file)],
        content: (await readFile(path.join(DEMO_IMAGES_DIR, file))).toString("base64"),
        access: "public" as const,
      }))
    )
  )
  return stored.map((f) => f.url)
}
