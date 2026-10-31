/** Where a product screen's photo and header bar stand as the screen scrolls. */
export type ProductScrollPosition = {
  /** How far the photo is moved down from where the page puts it, in points. */
  translateY: number
  /** The photo's stretch, about its centre: 1 unless pulled down. */
  scale: number
  /** The dark veil over the photo as the details slide over it: 0 to `PHOTO_DIM`. */
  dim: number
  /** Whether the big title has gone under the bar, so the bar shows it small on the page colour. */
  titled: boolean
}

export type ProductScrollLayout = {
  /** The photo's height from the screen's top edge, the part under the bar included. */
  photoHeight: number
  /** The scroll offset at which the title's foot meets the bar's; 0 until measured. */
  titleUnder: number
  /** Reduce Motion: the photo scrolls with the page, with no parallax, dim or stretch. */
  reduceMotion: boolean
}

/** The share of the page's movement the photo is held back by: it moves at half speed. */
const PARALLAX = 0.5
/** The veil's opacity once the photo's height has scrolled: a slight dim, never a blackout. */
const PHOTO_DIM = 0.25

/**
 * A product screen scrolled `scrollY` down. Scrolled up, the photo moves at half speed and dims
 * as the details cover it; pulled down, it stretches to fill the gap above it, its top edge kept
 * at the screen's. Runs on the UI thread with each scroll frame.
 */
export function productScrollPosition(scrollY: number, layout: ProductScrollLayout): ProductScrollPosition {
  "worklet"
  const { photoHeight, titleUnder, reduceMotion } = layout
  const titled = titleUnder > 0 && scrollY >= titleUnder
  if (reduceMotion || photoHeight === 0 || scrollY === 0) return { translateY: 0, scale: 1, dim: 0, titled }
  if (scrollY < 0) {
    // Pulled `-scrollY` down: as tall as the photo and the gap, centred halfway up the gap.
    return { translateY: scrollY / 2, scale: 1 - scrollY / photoHeight, dim: 0, titled }
  }
  const covered = Math.min(1, scrollY / photoHeight)
  return { translateY: scrollY * PARALLAX, scale: 1, dim: covered * PHOTO_DIM, titled }
}
