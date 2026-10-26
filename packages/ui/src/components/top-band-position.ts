/** Where a screen's top band stands against the status bar as the screen scrolls. */
export type TopBandPosition = {
  /** The page-colour strip behind the status bar: 0 while the band is under it, 1 once it has gone. */
  stripOpacity: number
  /** Whether the band has cleared the status bar, so its text follows the theme rather than staying white. */
  cleared: boolean
}

/** How far before the band clears the status bar the strip starts to fade in, in points. */
const TOP_BAND_FADE = 8

/**
 * A screen that opens on the indigo band, scrolled `scrollY` down: the band (measured from the
 * screen's top edge, status bar included) clears the status bar when its foot reaches the status
 * bar's, and the strip fades in over the last few points before. Until the band is measured
 * (height 0) it counts as behind the status bar. Runs on the UI thread with each scroll frame.
 */
export function topBandPosition(scrollY: number, bandHeight: number, statusBarHeight: number): TopBandPosition {
  "worklet"
  if (bandHeight === 0) return { stripOpacity: 0, cleared: false }
  const clearsAt = bandHeight - statusBarHeight
  const cleared = scrollY >= clearsAt
  const stripOpacity = Math.min(1, Math.max(0, (scrollY - (clearsAt - TOP_BAND_FADE)) / TOP_BAND_FADE))
  return { stripOpacity, cleared }
}

/**
 * The status bar's text over a top band: white while the band is behind it, then the theme's
 * own once the band has gone, dark in Light and white in Dark.
 */
export function topBandStatusBar(cleared: boolean, scheme: "light" | "dark"): "light" | "dark" {
  if (!cleared) return "light"
  return scheme === "dark" ? "light" : "dark"
}
