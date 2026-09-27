import { describe, expect, test } from "bun:test"
import { departments } from "./category"

const category = (id: string, rank: number, parent_category_id: string | null = null) => ({
  id,
  name: id,
  rank,
  parent_category_id,
})

describe("departments", () => {
  test("puts each top-level category over its own sub-categories, both in rank order", () => {
    const [food, fashion] = [category("Food", 0), category("Fashion", 1)]
    const [rice, beans, bags] = [category("Rice", 1, "Food"), category("Beans", 0, "Food"), category("Bags", 0, "Fashion")]

    expect(departments([bags, rice, fashion, beans, food])).toEqual([
      { department: food, categories: [beans, rice] },
      { department: fashion, categories: [bags] },
    ])
  })

  test("orders equal ranks by name", () => {
    const [b, a] = [category("B", 0), category("A", 0)]

    expect(departments([b, a]).map((d) => d.department)).toEqual([a, b])
  })

  test("leaves out a sub-category whose department isn't listed", () => {
    expect(departments([category("Rice", 0, "Hidden")])).toEqual([])
  })
})
