import { describe, expect, test } from "bun:test"
import { topBandPosition, topBandStatusBar } from "./top-band-position"

// An iPhone's status bar, and a band that runs 260 pt from the screen's top edge.
const STATUS_BAR = 54
const BAND = 260

describe("topBandPosition", () => {
  test("at rest the band is behind the status bar, with no strip", () => {
    expect(topBandPosition(0, BAND, STATUS_BAR)).toEqual({ stripOpacity: 0, cleared: false })
  })

  test("clears the status bar the moment the band's foot reaches the status bar's", () => {
    // 260 - 54: the band's last 206 pt have scrolled away.
    expect(topBandPosition(205.5, BAND, STATUS_BAR).cleared).toBe(false)
    expect(topBandPosition(206, BAND, STATUS_BAR)).toEqual({ stripOpacity: 1, cleared: true })
    expect(topBandPosition(900, BAND, STATUS_BAR)).toEqual({ stripOpacity: 1, cleared: true })
  })

  test("fades the strip in over the last 8 pt before the band clears", () => {
    expect(topBandPosition(198, BAND, STATUS_BAR).stripOpacity).toBe(0)
    expect(topBandPosition(200, BAND, STATUS_BAR).stripOpacity).toBe(0.25)
    expect(topBandPosition(202, BAND, STATUS_BAR)).toEqual({ stripOpacity: 0.5, cleared: false })
    expect(topBandPosition(150, BAND, STATUS_BAR).stripOpacity).toBe(0)
  })

  test("pulled down, the band stays behind the status bar", () => {
    expect(topBandPosition(-120, BAND, STATUS_BAR)).toEqual({ stripOpacity: 0, cleared: false })
  })

  test("a taller band, as when the greeting wraps at the largest text size, clears later", () => {
    expect(topBandPosition(206, 380, STATUS_BAR)).toEqual({ stripOpacity: 0, cleared: false })
    expect(topBandPosition(326, 380, STATUS_BAR)).toEqual({ stripOpacity: 1, cleared: true })
  })

  test("until the band is measured it is taken to be behind the status bar", () => {
    expect(topBandPosition(0, 0, STATUS_BAR)).toEqual({ stripOpacity: 0, cleared: false })
    expect(topBandPosition(400, 0, STATUS_BAR)).toEqual({ stripOpacity: 0, cleared: false })
  })
})

describe("topBandStatusBar", () => {
  test("white text on the band in either theme", () => {
    expect(topBandStatusBar(false, "light")).toBe("light")
    expect(topBandStatusBar(false, "dark")).toBe("light")
  })

  test("once the band has gone, dark text in Light and white in Dark", () => {
    expect(topBandStatusBar(true, "light")).toBe("dark")
    expect(topBandStatusBar(true, "dark")).toBe("light")
  })
})
