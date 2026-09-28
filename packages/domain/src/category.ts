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
