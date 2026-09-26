import type { TextStyle } from "react-native"

// Monochrome visual direction (docs/design.md). Code is the design system's source of
// truth: the design pass changes these values, not the component APIs.
// Every status chip pair meets WCAG AA (4.5:1) for its caption text.

const palette = {
  ink: "#000000",
  white: "#FFFFFF",
  /** Oja blue: brand mark, active tab, links, selection outlines, badges, progress. Never a primary button fill. */
  ojaBlue: "#0B5CFF",
  /** Deals only. */
  saffron: "#FFC043",
  tile: "#F3F3F3",
  divider: "#E2E2E2",
  grey: "#545454",
  /** Vendor secondary text and dividers, darker for contrast. */
  greyDark: "#2B2B2B",
  dividerDark: "#BDBDBD",
  green: "#047A40",
  greenTint: "#E6F4EC",
  amber: "#9A5B00",
  amberTint: "#FFF3DC",
  red: "#B3261E",
  redTint: "#FDECEC",
  blueTint: "#E7EFFF",
} as const

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger"

type TypeStyle = Pick<TextStyle, "fontSize" | "lineHeight" | "fontWeight" | "letterSpacing">
export type TextVariant = "title" | "heading" | "body" | "label" | "caption"

export type Theme = {
  name: "buyer" | "vendor"
  colors: {
    /** Primary buttons, headings, body text. */
    ink: string
    /** Text and icons on an ink fill. */
    onInk: string
    background: string
    /** Neutral tiles that contain product photos and grouped content. */
    surface: string
    divider: string
    textSecondary: string
    accent: string
    deal: string
    danger: string
  }
  /** Chip colours per status tone: text/symbol colour and background. */
  status: Record<StatusTone, { foreground: string; background: string }>
  space: { xs: number; sm: number; md: number; lg: number; xl: number; xxl: number }
  radius: { sm: number; md: number; lg: number; pill: number }
  /** Minimum height of anything tappable. */
  touchTarget: number
  /** Undefined uses the platform font until Manrope is loaded by the design pass. */
  fontFamily: string | undefined
  type: Record<TextVariant, TypeStyle>
}

const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 }
const radius = { sm: 6, md: 10, lg: 16, pill: 999 }

/** Clean retail: monochrome, product-first. */
export const buyerTheme: Theme = {
  name: "buyer",
  colors: {
    ink: palette.ink,
    onInk: palette.white,
    background: palette.white,
    surface: palette.tile,
    divider: palette.divider,
    textSecondary: palette.grey,
    accent: palette.ojaBlue,
    deal: palette.saffron,
    danger: palette.red,
  },
  status: {
    neutral: { foreground: palette.ink, background: palette.tile },
    info: { foreground: palette.ojaBlue, background: palette.blueTint },
    success: { foreground: palette.green, background: palette.greenTint },
    warning: { foreground: palette.amber, background: palette.amberTint },
    danger: { foreground: palette.red, background: palette.redTint },
  },
  space,
  radius,
  touchTarget: 48,
  fontFamily: undefined,
  type: {
    title: { fontSize: 28, lineHeight: 34, fontWeight: "700" },
    heading: { fontSize: 20, lineHeight: 26, fontWeight: "700" },
    body: { fontSize: 16, lineHeight: 22, fontWeight: "400" },
    label: { fontSize: 16, lineHeight: 20, fontWeight: "600" },
    caption: { fontSize: 13, lineHeight: 18, fontWeight: "400" },
  },
}

/**
 * High contrast for a busy shop floor: the same system at larger sizes, darker
 * secondary text, bigger touch targets and saturated state chips.
 */
export const vendorTheme: Theme = {
  name: "vendor",
  colors: {
    ...buyerTheme.colors,
    textSecondary: palette.greyDark,
    divider: palette.dividerDark,
  },
  status: {
    neutral: { foreground: palette.white, background: palette.ink },
    info: { foreground: palette.white, background: palette.ojaBlue },
    success: { foreground: palette.white, background: palette.green },
    warning: { foreground: palette.white, background: palette.amber },
    danger: { foreground: palette.white, background: palette.red },
  },
  space,
  radius,
  touchTarget: 56,
  fontFamily: undefined,
  type: {
    title: { fontSize: 32, lineHeight: 38, fontWeight: "800" },
    heading: { fontSize: 24, lineHeight: 30, fontWeight: "700" },
    body: { fontSize: 18, lineHeight: 26, fontWeight: "500" },
    label: { fontSize: 18, lineHeight: 22, fontWeight: "700" },
    caption: { fontSize: 15, lineHeight: 20, fontWeight: "500" },
  },
}
