// How buyers browse the catalogue's categories: departments (top-level categories)
// with their sub-categories beneath.

export type BrowseCategory = { id: string; name: string; rank: number; parent_category_id: string | null }

export type Department<C extends BrowseCategory> = { department: C; categories: C[] }

const byRank = (a: BrowseCategory, b: BrowseCategory) => a.rank - b.rank || a.name.localeCompare(b.name)

/** Each department over its own sub-categories, both in rank order (then by name). */
export function departments<C extends BrowseCategory>(categories: C[]): Department<C>[] {
  return categories
    .filter((c) => !c.parent_category_id)
    .sort(byRank)
    .map((department) => ({
      department,
      categories: categories.filter((c) => c.parent_category_id === department.id).sort(byRank),
    }))
}

/** A category's image as Mercur lists it: its icon (`type: "icon"`), thumbnail and banner share the list. */
export type CategoryImage = { url: string; is_thumbnail: boolean; type?: string | null }

/** The photo a category's tile shows: the image an admin marked as its thumbnail, or null for a plain tile. */
export function categoryThumbnail(category: { media_images?: readonly CategoryImage[] | null }): string | null {
  return category.media_images?.find((image) => image.is_thumbnail)?.url ?? null
}
