import type { StatusTone } from "@oja/domain"
import type { TextStyle } from "react-native"
import { FONT_FACES } from "./fonts"

// Adire: the Foundations section of docs/redesign/oja-adire-screens.html, which is authoritative.
// Code is the design system's source of truth: screens use these tokens only, never raw values.

/**
 * Mockup px to device points. Every size below is a mockup value times this, so changing it
 * resizes the whole app in proportion. The catalogue draws a 393pt iPhone 282px wide (1.394), but
 * that read large on a phone, so the apps use 1.2: body text 16pt, the main button 64pt (#75).
 */
export const SCALE = 1.2

const snapTo = (step: number) => (mockup: number) => Math.max(step, Math.round((mockup * SCALE) / step) * step)
/** Spacing and control heights sit on the 4pt grid. */
const grid = snapTo(4)
/** Corners round to even points. */
const even = snapTo(2)
/** Type sizes and line widths round to whole points. */
const points = snapTo(1)

/** Spacing, keyed by the mockup value ÷ 4: space[4] is the 16px screen gutter. */
export const space = {
  /** Icon to label, chip padding. */
  1: grid(4),
  /** Between chips and tiles; inside a row. */
  2: grid(8),
  /** Card padding; between rows. */
  3: grid(12),
  /** Screen gutter; between grid rows. */
  4: grid(16),
  /** Under a band; between orders. */
  5: grid(20),
  /** Above a section heading; between groups. */
  6: grid(24),
  /** Around confirmations. */
  8: grid(32),
  /** Empty and error states, top. */
  12: grid(48),
}

export const radius = {
  /** Chips, small tiles. */
  sm: even(8),
  /** Rows, inputs, product tiles. */
  md: even(12),
  /** Cards, buttons. */
  lg: even(16),
  /** Cards inside sheets. */
  xl: even(20),
  sheet: even(24),
  /** Pills and avatars. */
  pill: 999,
}

/** Control heights. */
export const control = {
  /** The sticky main action. */
  main: grid(52),
  /** A standard button or input. */
  md: grid(48),
  /** A button inside a list row. */
  row: grid(44),
}

/** The smallest touch target, in points and not scaled: use hitSlop where the drawn shape is smaller. */
export const HIT_AREA = 44

export const line = {
  /** Dividers and card edges: a hairline isn't scaled. */
  divider: 1,
  /** Input and option outlines. */
  input: points(1.5),
  /** The selected tab's underline. */
  tab: points(2.5),
  /** The focus ring, outside the shape. */
  ring: points(3),
  /** A row's focus ring, inside its edge-to-edge shape (Foundations gives it in points). */
  ringInset: 2,
}

/** How far text grows with the system's text-size setting. Once text reaches it, grids drop to one column. */
export const MAX_FONT_SCALE = 1.3

/** Sizes of the shop and product building blocks. */
export const block = {
  /** A product tile in a rail. */
  railTile: points(118),
  /** The add and save buttons on a product photo: drawn small, with a 44pt hit area. */
  photoButton: points(26),
  /** The quantity stepper's minus and plus: drawn 32 mockup px, never under the 44pt touch target. */
  stepperHalf: Math.max(HIT_AREA, points(32)),
  /** A shop's banner, under the status bar. */
  banner: points(150),
  /** The empty state's pattern emblem, and the error state's quieter one. */
  emblem: points(112),
  quietEmblem: points(88),
  /** A code box, one per digit. */
  codeBox: grid(48),
  /** A multi-line input's least height. */
  textArea: grid(84),
  /** Above an empty or error state's emblem, and the state's side inset (the final `.empty` padding). */
  stateTop: grid(56),
  stateSide: grid(28),
}

/** A shop mark (logo or monogram) by where it sits: a row, a shop group's header, the shop page. */
export const shopMark = {
  sm: { size: points(32), radius: even(12), fontSize: points(11.5) },
  md: { size: points(48), radius: even(12), fontSize: points(14) },
  lg: { size: points(52), radius: even(16), fontSize: points(18), border: points(3) },
}

/** Bricolage Grotesque, 18 mockup px and up. */
export type DisplayVariant = "displayXxl" | "displayXl" | "displayLg" | "titleRoot" | "titleNamed" | "titlePushed" | "heading"
/** Manrope. */
export type BodyVariant = "strong" | "body" | "meta" | "label"
export type TextVariant = DisplayVariant | BodyVariant
export type FontWeight = keyof typeof FONT_FACES.text
export type DisplayWeight = keyof typeof FONT_FACES.display

type TypeStyle = Required<Pick<TextStyle, "fontFamily" | "fontSize" | "lineHeight">>

const display = (mockup: number, weight: DisplayWeight = "extrabold"): TypeStyle => {
  const fontSize = points(mockup)
  return { fontFamily: FONT_FACES.display[weight], fontSize, lineHeight: Math.round(fontSize * 1.1) }
}
const text = (mockup: number, weight: FontWeight): TypeStyle => {
  const fontSize = points(mockup)
  return { fontFamily: FONT_FACES.text[weight], fontSize, lineHeight: Math.round(fontSize * 1.4) }
}

/** One title per screen, sized by its role; then section headings, row titles and meta. */
export const typeScale: Record<TextVariant, TypeStyle> = {
  /** Pickup digits. */
  displayXxl: display(44),
  /** The takeover moment. */
  displayXl: display(34),
  /** Confirmation. */
  displayLg: display(28),
  /** A tab root's title. */
  titleRoot: display(26),
  /** A shop or product name, a band headline. */
  titleNamed: display(22),
  /** A pushed screen's title. */
  titlePushed: display(20),
  /** Section headings, totals. */
  heading: display(18),
  /** Names, prices, buttons. */
  strong: text(14, "extrabold"),
  /** Body, row titles: 400 to 700. */
  body: text(13, "regular"),
  /** Meta, secondary: 400 to 700. */
  meta: text(11.5, "regular"),
  /** Labels, chips, tab bar: 600 to 800. */
  label: text(10.5, "bold"),
}

export const DISPLAY_VARIANTS: ReadonlySet<TextVariant> = new Set<DisplayVariant>([
  "displayXxl",
  "displayXl",
  "displayLg",
  "titleRoot",
  "titleNamed",
  "titlePushed",
  "heading",
])

/** Lucide icons, in points as Foundations gives them, and the drawn stroke, which scales with the size. */
export const icon = {
  size: { default: 24, add: 22, step: 20, chip: 16, emblem: points(40), quietEmblem: points(34) },
  stroke: { default: 1.8, add: 2.4, step: 1.8, chip: 2.2, emblem: 1.6, quietEmblem: 1.6 },
} as const

/** Durations in ms (Foundations, Motion). Under Reduce Motion nothing slides or pulses: everything cross-fades. */
export const motion = {
  /** Press feedback shows at once and fades over this. */
  press: 100,
  /** The tab and segment underline slides, ease-out. */
  underline: 200,
  crossFade: 150,
  /** A row added to or removed from a list. */
  listLayout: 200,
  takeoverFade: 250,
  toastSlide: 200,
  toastHold: 4000,
  /** The new-order alarm ring, ease-out, scaling from 0.92 to 1.3 as it fades. */
  alarmPulse: 1600,
  /** The skeleton shimmer sweep, ease-in-out. */
  shimmer: 1400,
  spinnerTurn: 900,
} as const

/**
 * Light is flat and dark lifts surfaces with lighter greys (bg, then raised, then tile). Only
 * these float: the map's locate button and pin, and the save heart on a photo.
 */
export const elevation = {
  floating: { boxShadow: "0px 4px 12px rgba(0, 0, 0, 0.15)" },
  heart: { boxShadow: "0px 1px 3px rgba(0, 0, 0, 0.15)" },
} as const

export type Theme = {
  scheme: "light" | "dark"
  colors: {
    /** Page. */
    bg: string
    /** Page behind grouped cards. */
    bgGrouped: string
    /** Cards, inputs, sheets, tab bar. */
    raised: string
    /** Mist: secondary buttons, fact boxes, chips, skeletons. */
    tile: string
    /** Behind product photos: white in both themes, with no outline. */
    productTile: string
    /** Laid over a product tile and its photo together (`PhotoTile`): none in light; in dark, the page colour, dimming white to about #D8D8DC. */
    photoVeil: string | null
    /** Dividers, card edges. */
    line: string
    /** The lighter rule between groups in a list: orders, shops in the cart, checkout and an order, reviews. */
    divider: string
    /** Input and checkbox outlines (3:1). */
    control: string
    /** Text. */
    ink: string
    /** Secondary text, placeholders. */
    muted: string
    /** The brand band and the new-order takeover: the same indigo in both themes. */
    band: string
    onBand: string
    /** A light wash on the band: the takeover's quantity pills. */
    onBandTile: string
    /** The main button. */
    primary: string
    onPrimary: string
    /** Selection outlines, the active tab, ratings. */
    accent: string
    /** Links, pattern strokes. */
    link: string
    /** Fill of a selected option. */
    selected: string
    /** Focus ring. */
    ring: string
    /** Unselected tab labels. */
    tabInactive: string
    /** Deal badges and progress only, the same in both themes, always with dark text. */
    sun: string
    onSun: string
    /** Open, done, picked: chips, badges and pills only. */
    leaf: string
    leafText: string
    /** Waiting on the buyer, the last two hours to accept. */
    ember: string
    emberText: string
    /** Destructive buttons, errors. */
    danger: string
    dangerText: string
    dangerBg: string
    /** Laid over a control while it's pressed. */
    pressed: string
    /** Behind sheets. */
    scrim: string
    /** The adire pattern's strokes, on the band in both themes. */
    pattern: string
    /** The skeleton shimmer's sweep. */
    shimmer: string
    /** Toasts: the opposite of the page. */
    inverse: string
    onInverse: string
    inverseSuccess: string
    inverseDanger: string
    /** The accept clock's ring around a time chip: its track, the time left, and the last two hours. */
    clockTrack: string
    clockRing: string
    clockRingUrgent: string
    /** The new-order takeover, on the band in both themes: secondary text, View order's fill and the alarm ring's track. */
    onBandSoft: string
    onBandAction: string
    onBandTrack: string
  }
  /** Chip text and background per tone, each at 7:1 or more (catalogue Accessibility). */
  status: Record<StatusTone, { foreground: string; background: string }>
  space: typeof space
  radius: typeof radius
  block: typeof block
  shopMark: typeof shopMark
  control: typeof control
  hitArea: number
  line: typeof line
  type: typeof typeScale
  icon: typeof icon
  motion: typeof motion
  elevation: typeof elevation
}

const sizes = {
  space,
  radius,
  block,
  shopMark,
  control,
  hitArea: HIT_AREA,
  line,
  type: typeScale,
  icon,
  motion,
  elevation,
}

const white = "#FFFFFF"
const indigo = "#1B2559"
const sun = "#F2B33D"
const leaf = "#186441"
const ember = "#90411A"
const red = "#AA2318"
const scrim = "rgba(0, 0, 0, 0.6)"
const pattern = "#5767C2"

export const lightTheme: Theme = {
  scheme: "light",
  colors: {
    bg: white,
    bgGrouped: "#F7F8FC",
    raised: white,
    tile: "#EEF0F7",
    productTile: white,
    photoVeil: null,
    line: "#DDE1EE",
    divider: "#E4E6EE",
    control: "#80869E",
    ink: "#12162B",
    muted: "#494F66",
    band: indigo,
    onBand: white,
    onBandTile: "rgba(255, 255, 255, 0.16)",
    primary: indigo,
    onPrimary: white,
    accent: indigo,
    link: "#2E3D8F",
    selected: "#F4F5FB",
    ring: "#E3E6F3",
    tabInactive: "#5B6178",
    sun,
    onSun: "#12162B",
    leaf,
    leafText: "#165A3C",
    ember,
    emberText: "#84391A",
    danger: red,
    dangerText: "#962218",
    dangerBg: "#FBEAE8",
    pressed: "rgba(18, 22, 43, 0.12)",
    scrim,
    pattern,
    shimmer: "rgba(255, 255, 255, 0.55)",
    inverse: "#12162B",
    onInverse: white,
    inverseSuccess: "#8FD3AE",
    inverseDanger: "#F2938A",
    clockTrack: "rgba(18, 22, 43, 0.08)",
    clockRing: "#C98A1A",
    clockRingUrgent: ember,
    onBandSoft: "rgba(255, 255, 255, 0.85)",
    onBandAction: "rgba(255, 255, 255, 0.14)",
    onBandTrack: "rgba(255, 255, 255, 0.2)",
  },
  status: {
    neutral: { foreground: "#494F66", background: "#F0F1F4" },
    info: { foreground: indigo, background: "#EEF0F7" },
    success: { foreground: "#165A3C", background: "#E3F2EA" },
    new: { foreground: "#714800", background: "#FDF1D8" },
    attention: { foreground: "#84391A", background: "#FBEDE3" },
    danger: { foreground: "#962218", background: "#FBEAE8" },
  },
  ...sizes,
}

/** Neutral charcoal with no brand tint, so indigo keeps its light-mode jobs. */
export const darkTheme: Theme = {
  scheme: "dark",
  colors: {
    bg: "#111113",
    bgGrouped: "#111113",
    raised: "#1C1C1F",
    tile: "#26262A",
    productTile: white,
    photoVeil: "rgba(17, 17, 19, 0.16)",
    line: "#333338",
    divider: "#2A2A2F",
    control: "#7A7A83",
    ink: "#F2F2F4",
    muted: "#B4B4BC",
    band: indigo,
    onBand: white,
    onBandTile: "rgba(255, 255, 255, 0.16)",
    primary: "#3D4DBB",
    onPrimary: white,
    accent: "#AEB8FF",
    link: "#AEB8FF",
    selected: "#2A2A30",
    ring: "#3A3F66",
    tabInactive: "#B4B4BC",
    sun,
    onSun: "#12162B",
    leaf,
    leafText: "#6FD6A0",
    ember,
    emberText: "#F0A474",
    danger: red,
    dangerText: "#F2938A",
    dangerBg: "#3A1717",
    pressed: "rgba(255, 255, 255, 0.12)",
    scrim,
    pattern,
    shimmer: "rgba(255, 255, 255, 0.06)",
    inverse: "#E9EBF5",
    onInverse: "#12152A",
    inverseSuccess: "#165A3C",
    inverseDanger: "#962218",
    clockTrack: "rgba(255, 255, 255, 0.1)",
    clockRing: "#F2C76B",
    clockRingUrgent: "#F0A474",
    onBandSoft: "rgba(255, 255, 255, 0.85)",
    onBandAction: "rgba(255, 255, 255, 0.14)",
    onBandTrack: "rgba(255, 255, 255, 0.2)",
  },
  status: {
    neutral: { foreground: "#B4B4BC", background: "#26262A" },
    info: { foreground: "#AEB8FF", background: "#23263A" },
    success: { foreground: "#6FD6A0", background: "#14281D" },
    new: { foreground: "#F2C76B", background: "#2E2614" },
    attention: { foreground: "#F0A474", background: "#30221A" },
    danger: { foreground: "#F2938A", background: "#311B1B" },
  },
  ...sizes,
}

/** The focus ring as a box shadow: 4pt outside the shape, or 2pt inside it for rows. */
export const focusRing = (theme: Theme, inset = false) =>
  inset
    ? `inset 0px 0px 0px ${theme.line.ringInset}px ${theme.colors.ring}`
    : `0px 0px 0px ${theme.line.ring}px ${theme.colors.ring}`
