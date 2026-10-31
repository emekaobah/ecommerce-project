import { describe, expect, test } from "bun:test"
import { productScrollPosition } from "./product-scroll-position"

// A photo that runs 400 pt from the screen's top edge (under the bar too), and a title whose foot
// meets the bar's foot 300 pt down the scroll.
const PHOTO = 400
const TITLE_UNDER = 300
const layout = { photoHeight: PHOTO, titleUnder: TITLE_UNDER, reduceMotion: false }

describe("productScrollPosition", () => {
  test("at rest the photo sits still, undimmed, with no title in the bar", () => {
    expect(productScrollPosition(0, layout)).toEqual({ translateY: 0, scale: 1, dim: 0, titled: false })
  })

  test("scrolled up, the photo moves at half speed and dims as the details cover it", () => {
    // The page has moved 200 pt; the photo is held back 100 pt, so it has moved 100.
    expect(productScrollPosition(200, layout)).toMatchObject({ translateY: 100, scale: 1, dim: 0.125 })
    expect(productScrollPosition(PHOTO, layout).dim).toBe(0.25)
    expect(productScrollPosition(900, layout).dim).toBe(0.25)
  })

  test("pulled down, the photo stretches to fill the gap, its top edge pinned to the screen's", () => {
    // 100 pt pulled: 500 pt tall from 400, centred 50 pt higher than the page has moved it.
    expect(productScrollPosition(-100, layout)).toEqual({ translateY: -50, scale: 1.25, dim: 0, titled: false })
  })

  test("the title shows in the bar once the big one's foot is under the bar, and leaves on the way back", () => {
    expect(productScrollPosition(299.5, layout).titled).toBe(false)
    expect(productScrollPosition(TITLE_UNDER, layout).titled).toBe(true)
    expect(productScrollPosition(1200, layout).titled).toBe(true)
  })

  test("until the title is measured the bar stays untitled", () => {
    expect(productScrollPosition(1200, { ...layout, titleUnder: 0 }).titled).toBe(false)
  })

  test("under Reduce Motion the photo scrolls with the page: no parallax, dim or stretch", () => {
    const still = { ...layout, reduceMotion: true }
    expect(productScrollPosition(200, still)).toEqual({ translateY: 0, scale: 1, dim: 0, titled: false })
    expect(productScrollPosition(-100, still)).toEqual({ translateY: 0, scale: 1, dim: 0, titled: false })
    expect(productScrollPosition(TITLE_UNDER, still).titled).toBe(true)
  })
})
