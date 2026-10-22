import { Text as RNText, type TextProps as RNTextProps } from "react-native"
import { FONT_FACES } from "../fonts"
import { useTheme } from "../theme"
import {
  DISPLAY_VARIANTS,
  MAX_FONT_SCALE,
  type BodyVariant,
  type DisplayVariant,
  type DisplayWeight,
  type FontWeight,
} from "../tokens"

export type TextTone = "default" | "muted" | "accent" | "link" | "onPrimary" | "onBand" | "danger" | "leaf" | "ember"

/** Display variants come in bold and extrabold only; the rest in all four weights. */
type VariantWeight = { variant: DisplayVariant; weight?: DisplayWeight } | { variant?: BodyVariant; weight?: FontWeight }

export type TextProps = RNTextProps &
  VariantWeight & {
    tone?: TextTone
    /** Tabular figures, so prices, totals and codes line up. */
    tabular?: boolean
  }

/**
 * The weight is a face of its own (Android can't pick one inside a family), so a style never sets
 * fontWeight. Text grows with the system's text size up to MAX_FONT_SCALE.
 */
export function Text({ variant = "body", weight, tone = "default", tabular, style, ...rest }: TextProps) {
  const theme = useTheme()
  const color = {
    default: theme.colors.ink,
    muted: theme.colors.muted,
    accent: theme.colors.accent,
    link: theme.colors.link,
    onPrimary: theme.colors.onPrimary,
    onBand: theme.colors.onBand,
    danger: theme.colors.dangerText,
    leaf: theme.colors.leafText,
    ember: theme.colors.emberText,
  }[tone]
  const display = DISPLAY_VARIANTS.has(variant)
  const face = weight && (display ? FONT_FACES.display[weight as DisplayWeight] : FONT_FACES.text[weight])
  return (
    <RNText
      accessibilityRole={display ? "header" : undefined}
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      style={[
        theme.type[variant],
        { color },
        face ? { fontFamily: face } : null,
        tabular ? { fontVariant: ["tabular-nums"] } : null,
        style,
      ]}
      {...rest}
    />
  )
}
