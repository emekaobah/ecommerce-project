import { Text as RNText, type TextProps as RNTextProps } from "react-native"
import { useTheme } from "../theme"
import type { TextVariant } from "../tokens"

export type TextTone = "default" | "secondary" | "accent" | "inverse" | "danger"

export type TextProps = RNTextProps & {
  variant?: TextVariant
  tone?: TextTone
}

export function Text({ variant = "body", tone = "default", style, ...rest }: TextProps) {
  const theme = useTheme()
  const color = {
    default: theme.colors.ink,
    secondary: theme.colors.textSecondary,
    accent: theme.colors.accent,
    inverse: theme.colors.onInk,
    danger: theme.colors.danger,
  }[tone]
  return (
    <RNText
      accessibilityRole={variant === "title" || variant === "heading" ? "header" : undefined}
      style={[theme.type[variant], { color, fontFamily: theme.fontFamily }, style]}
      {...rest}
    />
  )
}
