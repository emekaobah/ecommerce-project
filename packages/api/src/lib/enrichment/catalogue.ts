import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ProductStatus } from "@mercurjs/types"
import { attributionOf } from "./record"
import type { EnrichmentSource } from "./source"

type Scope = Pick<MedusaContainer, "resolve">

type CatalogueProduct = {
  id: string
  title: string | null
  description: string | null
  weight: number | string | null
  thumbnail: string | null
  images?: { url: string }[] | null
  categories?: { id: string }[] | null
}

/**
 * The published catalogue, matched by barcode: another published product whose
 * variant carries the same barcode, EAN or UPC. Its data is already public and its
 * images already ours, so it needs no credit of its own, but it passes on the
 * credits its data owes to the databases that enriched it.
 */
export function catalogueSource(scope: Scope): EnrichmentSource {
  return {
    id: "catalogue",
    name: "Catalogue",
    policy: { public_data: true, image_rights: true, attribution: null, requests_per_minute: 6000 },
    async lookup({ barcode }) {
      if (!barcode) return null
      const query = scope.resolve(ContainerRegistrationKeys.QUERY)
      const { data: variants } = await query.graph({
        entity: "product_variant",
        fields: ["product_id"],
        filters: { $or: [{ barcode }, { ean: barcode }, { upc: barcode }] } as any,
      })
      const productIds = [...new Set((variants as { product_id: string }[]).map((v) => v.product_id))]
      if (!productIds.length) return null
      const { data } = await query.graph({
        entity: "product",
        fields: ["id", "title", "description", "weight", "thumbnail", "images.url", "categories.id"],
        filters: { id: productIds, status: ProductStatus.PUBLISHED },
      })
      const [product] = data as CatalogueProduct[]
      if (!product) return null
      const images = (product.images ?? []).map((i) => i.url)
      if (!images.length && product.thumbnail) images.push(product.thumbnail)
      const weight = product.weight == null ? null : Number(product.weight)
      return {
        url: null,
        attribution: await attributionOf(scope, product.id),
        fields: {
          ...(product.title ? { title: product.title } : {}),
          ...(product.description ? { description: product.description } : {}),
          ...(weight ? { weight } : {}),
          ...(images.length ? { image_urls: images } : {}),
          ...(product.categories?.length ? { category_ids: product.categories.map((c) => c.id) } : {}),
        },
      }
    },
  }
}
