import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { toHandle } from "@medusajs/framework/utils"
import { areStoredCopies, isStoredCopy, productPhotoFiles, shopImageFiles } from "../scripts/demo-images"
import { SEED_PRODUCTS, SEED_SELLERS } from "../scripts/seed-data"

const DIR = path.join(__dirname, "../scripts/demo-images")

/** Reads a WebP's header: whether it carries alpha, and its longer side in pixels. */
function webpInfo(bytes: Buffer): { alpha: boolean; longSide: number } | "not a WebP" {
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return "not a WebP"
  const chunk = bytes.toString("ascii", 12, 16)
  if (chunk === "VP8X") {
    // Extended format: flags byte (bit 4 is alpha), then 24-bit width-1 and height-1.
    const alpha = (bytes[20] & 0x10) !== 0
    const width = bytes.readUIntLE(24, 3) + 1
    const height = bytes.readUIntLE(27, 3) + 1
    return { alpha, longSide: Math.max(width, height) }
  }
  if (chunk === "VP8L") {
    // Lossless: 14-bit width-1 and height-1, then the alpha-is-used bit.
    const bits = bytes.readUInt32LE(21)
    const width = (bits & 0x3fff) + 1
    const height = ((bits >> 14) & 0x3fff) + 1
    return { alpha: ((bits >> 28) & 1) === 1, longSide: Math.max(width, height) }
  }
  // Simple lossy (VP8 ): no alpha; after the 3-byte frame tag and start code, 14-bit width and height.
  return { alpha: false, longSide: Math.max(bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff) }
}

describe("demo images", () => {
  it("lists a product's photos in gallery order, its main photo first", () => {
    expect(productPhotoFiles({ title: "Frozen Whole Chicken 1.2kg", photos: 1 })).toEqual(["frozen-whole-chicken-12kg.webp"])
    expect(productPhotoFiles({ title: "Adire Kaftan", photos: 3 })).toEqual([
      "adire-kaftan.webp",
      "adire-kaftan-2.webp",
      "adire-kaftan-3.webp",
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

  it("ships each product photo as a WebP, 800px on its long side, the main photo cut out with alpha", () => {
    for (const product of SEED_PRODUCTS) {
      // Gallery close-ups that fill the frame have no background to remove, so may be opaque.
      productPhotoFiles(product).forEach((file, i) => {
        const info = webpInfo(readFileSync(path.join(DIR, "products", file)))
        expect([file, info === "not a WebP" ? info : info.longSide]).toEqual([file, 800])
        if (i === 0) expect([file, info !== "not a WebP" && info.alpha]).toEqual([file, true])
      })
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
      expect(isStoredCopy("http://localhost:9000/static/1761200000000-adire-kaftan.webp", "adire-kaftan.webp")).toBe(true)
    })

    it("recognises an R2 upload, stored as <name>-<ulid>", () => {
      expect(
        isStoredCopy("https://files.oja.ng/adire-kaftan-2-01JB8Z3Q4K5M6N7P8R9S0T1V2W.webp", "adire-kaftan-2.webp")
      ).toBe(true)
    })

    it("tells a product's photos apart, even where a handle ends in a number", () => {
      expect(isStoredCopy("http://localhost:9000/static/1761200000000-adire-kaftan-2.webp", "adire-kaftan.webp")).toBe(false)
      expect(isStoredCopy("http://localhost:9000/static/1761200000000-ofada-rice-5kg.webp", "ofada-rice-5kg-2.webp")).toBe(false)
      expect(
        isStoredCopy("https://files.oja.ng/honey-beans-oloyin-2kg-2-01JB8Z3Q4K5M6N7P8R9S0T1V2W.webp", "honey-beans-oloyin-2kg.webp")
      ).toBe(false)
    })

    it("rejects placeholders, other files and missing URLs", () => {
      const handle = toHandle("Ofada Rice 5kg")
      expect(isStoredCopy("https://placehold.co/800x800/F3F3F3/000000/png?text=Ofada+Rice+5kg", `${handle}.webp`)).toBe(false)
      expect(isStoredCopy("http://localhost:9000/static/1761200000000-product-image.webp", `${handle}.webp`)).toBe(false)
      expect(isStoredCopy(null, `${handle}.webp`)).toBe(false)
      expect(isStoredCopy("not a url", `${handle}.webp`)).toBe(false)
    })
  })

  it("matches a gallery only when it holds exactly the photos, in order", () => {
    const files = ["adire-kaftan.webp", "adire-kaftan-2.webp"]
    const url = (file: string) => `http://localhost:9000/static/1761200000000-${file}`
    expect(areStoredCopies(files.map(url), files)).toBe(true)
    expect(areStoredCopies([...files].reverse().map(url), files)).toBe(false)
    expect(areStoredCopies([url(files[0])], files)).toBe(false)
    expect(areStoredCopies([...files, "adire-kaftan-3.webp"].map(url), files)).toBe(false)
  })
})
