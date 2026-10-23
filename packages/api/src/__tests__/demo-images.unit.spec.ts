import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { toHandle } from "@medusajs/framework/utils"
import { areStoredCopies, isStoredCopy, productPhotoFiles, shopImageFiles } from "../scripts/demo-images"
import { SEED_PRODUCTS, SEED_SELLERS } from "../scripts/seed-data"

const DIR = path.join(__dirname, "../scripts/demo-images")

describe("demo images", () => {
  it("lists a product's photos in gallery order, its main photo first", () => {
    expect(productPhotoFiles({ title: "Frozen Whole Chicken 1.2kg", photos: 1 })).toEqual(["frozen-whole-chicken-12kg.jpg"])
    expect(productPhotoFiles({ title: "Adire Kaftan", photos: 3 })).toEqual([
      "adire-kaftan.jpg",
      "adire-kaftan-2.jpg",
      "adire-kaftan-3.jpg",
    ])
  })

  it("names a shop's logo and banner by its handle", () => {
    expect(shopImageFiles("Iya Bisi Foodstuff")).toEqual({
      logo: "iya-bisi-foodstuff-logo.png",
      banner: "iya-bisi-foodstuff-banner.png",
    })
  })

  it("has every seeded product's photos and every seeded shop's logo and banner", () => {
    for (const product of SEED_PRODUCTS) {
      expect(product.photos).toBeGreaterThan(0)
      for (const file of productPhotoFiles(product)) expect([file, existsSync(path.join(DIR, "products", file))]).toEqual([file, true])
    }
    for (const shop of SEED_SELLERS) {
      for (const file of Object.values(shopImageFiles(shop.name))) {
        expect([file, existsSync(path.join(DIR, "shops", file))]).toEqual([file, true])
      }
    }
  })

  it("ships no photo the seed doesn't use", () => {
    const used = new Set(SEED_PRODUCTS.flatMap(productPhotoFiles))
    expect(readdirSync(path.join(DIR, "products")).filter((f) => !used.has(f))).toEqual([])
    const shops = new Set(SEED_SELLERS.flatMap((s) => Object.values(shopImageFiles(s.name))))
    expect(readdirSync(path.join(DIR, "shops")).filter((f) => !shops.has(f))).toEqual([])
  })

  describe("isStoredCopy", () => {
    it("recognises a local upload, stored as <timestamp>-<name>", () => {
      expect(isStoredCopy("http://localhost:9000/static/1761200000000-adire-kaftan.jpg", "adire-kaftan.jpg")).toBe(true)
    })

    it("recognises an R2 upload, stored as <name>-<ulid>", () => {
      expect(
        isStoredCopy("https://files.oja.ng/adire-kaftan-2-01JB8Z3Q4K5M6N7P8R9S0T1V2W.jpg", "adire-kaftan-2.jpg")
      ).toBe(true)
    })

    it("tells a product's photos apart, even where a handle ends in a number", () => {
      expect(isStoredCopy("http://localhost:9000/static/1761200000000-adire-kaftan-2.jpg", "adire-kaftan.jpg")).toBe(false)
      expect(isStoredCopy("http://localhost:9000/static/1761200000000-ofada-rice-5kg.jpg", "ofada-rice-5kg-2.jpg")).toBe(false)
      expect(
        isStoredCopy("https://files.oja.ng/honey-beans-oloyin-2kg-2-01JB8Z3Q4K5M6N7P8R9S0T1V2W.jpg", "honey-beans-oloyin-2kg.jpg")
      ).toBe(false)
    })

    it("rejects placeholders, other files and missing URLs", () => {
      const handle = toHandle("Ofada Rice 5kg")
      expect(isStoredCopy("https://placehold.co/800x800/F3F3F3/000000/png?text=Ofada+Rice+5kg", `${handle}.jpg`)).toBe(false)
      expect(isStoredCopy("http://localhost:9000/static/1761200000000-product-image.jpg", `${handle}.jpg`)).toBe(false)
      expect(isStoredCopy(null, `${handle}.jpg`)).toBe(false)
      expect(isStoredCopy("not a url", `${handle}.jpg`)).toBe(false)
    })
  })

  it("matches a gallery only when it holds exactly the photos, in order", () => {
    const files = ["adire-kaftan.jpg", "adire-kaftan-2.jpg"]
    const url = (file: string) => `http://localhost:9000/static/1761200000000-${file}`
    expect(areStoredCopies(files.map(url), files)).toBe(true)
    expect(areStoredCopies([...files].reverse().map(url), files)).toBe(false)
    expect(areStoredCopies([url(files[0])], files)).toBe(false)
    expect(areStoredCopies([...files, "adire-kaftan-3.jpg"].map(url), files)).toBe(false)
  })
})
