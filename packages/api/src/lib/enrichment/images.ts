import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

type Scope = Pick<MedusaContainer, "resolve">

// Product photos, not posters: anything larger is refused.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
}

/**
 * Copies an image into our file storage (R2 in production) and returns its URL
 * there: product images are never hotlinked (docs/design.md). Throws when the
 * image can't be fetched or isn't a supported image.
 */
export async function copyImage(scope: Scope, url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  const mimeType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? ""
  const extension = EXTENSIONS[mimeType]
  if (!extension) throw new Error(`${url} is not a JPEG, PNG, WebP or GIF image`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`${url} is larger than 10 MB`)

  const [file] = await scope.resolve(Modules.FILE).createFiles([
    { filename: `product-image.${extension}`, mimeType, content: bytes.toString("base64"), access: "public" },
  ])
  return file.url
}
