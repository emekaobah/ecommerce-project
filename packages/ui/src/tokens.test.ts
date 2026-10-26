import { describe, expect, test } from "bun:test"
import { darkTheme, lightTheme } from "./tokens"

// Product photos are transparent cut-outs on the theme's tile (#115).
describe("product tile", () => {
  test("is white in Light", () => {
    expect(lightTheme.colors.productTile).toBe("#FFFFFF")
  })

  test("is charcoal in Dark, the dark tile colour", () => {
    expect(darkTheme.colors.productTile).toBe("#26262A")
  })

  test("has no veil in either theme", () => {
    expect(lightTheme.colors).not.toHaveProperty("photoVeil")
    expect(darkTheme.colors).not.toHaveProperty("photoVeil")
  })
})

// The pickup QR stays black on white, and shop logos are unchanged, in both themes.
describe("paper", () => {
  test("is white in both themes", () => {
    expect(lightTheme.colors.paper).toBe("#FFFFFF")
    expect(darkTheme.colors.paper).toBe("#FFFFFF")
  })
})
