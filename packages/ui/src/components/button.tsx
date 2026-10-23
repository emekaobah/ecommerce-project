import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native"
import { useTheme } from "../theme"
import type { Theme } from "../tokens"
import { Icon, type IconName } from "./icon"
import { PressableSurface } from "./pressable-surface"
import { Text, type TextTone } from "./text"

export type ButtonVariant = "primary" | "secondary" | "danger" | "link"

export type ButtonProps = {
  label: string
  onPress: () => void
  variant?: ButtonVariant
  /** "main" for the sticky main action at the foot of a screen, "row" inside a list row. */
  size?: "main" | "md" | "row"
  /** Right-aligned detail in the label, e.g. the price on "Place order". */
  detail?: string
  /** Drawn before the label, e.g. refresh on "Try again". */
  icon?: IconName
  disabled?: boolean
  loading?: boolean
  /** "accent" colours a secondary button's label like a link: "In cart · View cart". */
  tone?: "accent"
  style?: StyleProp<ViewStyle>
}

const LABEL_TONES: Record<ButtonVariant, TextTone> = {
  primary: "onPrimary",
  secondary: "default",
  danger: "onPrimary",
  link: "link",
}

const fills = (theme: Theme): Record<ButtonVariant, string | undefined> => ({
  primary: theme.colors.primary,
  secondary: theme.colors.tile,
  danger: theme.colors.danger,
  link: undefined,
})

/** The label's colour, for the icon and spinner beside it. */
const inks = (theme: Theme): Record<ButtonVariant, string> => ({
  primary: theme.colors.onPrimary,
  secondary: theme.colors.ink,
  danger: theme.colors.onPrimary,
  link: theme.colors.link,
})

/** The label's tone and the matching ink for its icon and spinner. */
function labelColour(theme: Theme, variant: ButtonVariant, disabled: boolean | undefined, labelTone: "accent" | undefined) {
  if (disabled) return { tone: "muted" as TextTone, ink: theme.colors.muted }
  if (labelTone === "accent") return { tone: "accent" as TextTone, ink: theme.colors.accent }
  return { tone: LABEL_TONES[variant], ink: inks(theme)[variant] }
}

/**
 * Primary is the one indigo action on a screen; secondary is Mist; danger is for destructive
 * actions only; link is bold link-coloured text, with no underline. Disabled turns the fill to Mist with a muted label (never faded).
 * Loading lays a spinner over the label, so the width stays the same, and keeps a price beside it.
 * At large text sizes the label wraps and the price stays whole beside it, never cut off.
 */
export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  detail,
  icon,
  disabled,
  loading,
  tone: labelTone,
  style,
}: Readonly<ButtonProps>) {
  const theme = useTheme()
  const inactive = disabled || loading
  const isLink = variant === "link"
  const fill = disabled && !isLink ? theme.colors.tile : fills(theme)[variant]
  const { tone, ink } = labelColour(theme, variant, disabled, labelTone)

  return (
    <PressableSurface
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={[
        styles.base,
        {
          minHeight: isLink ? theme.hitArea : theme.control[size],
          borderRadius: theme.radius.lg,
          paddingHorizontal: isLink ? 0 : theme.space[4],
          paddingVertical: isLink ? 0 : theme.space[2],
          backgroundColor: fill,
        },
        style,
      ]}
    >
      <View style={[styles.content, { gap: theme.space[2] }, detail ? styles.spread : null]}>
        <View style={[styles.label, styles.shrink, { gap: theme.space[2] }]}>
          <View style={[styles.label, styles.shrink, { gap: theme.space[2] }, loading && styles.hidden]}>
            {icon ? <Icon name={icon} use="chip" color={ink} /> : null}
            <Text variant="strong" tone={tone} style={styles.shrink}>
              {label}
            </Text>
          </View>
          {loading ? <ActivityIndicator color={ink} style={StyleSheet.absoluteFill} /> : null}
        </View>
        {detail ? (
          <Text variant="strong" tone={tone} tabular style={styles.whole}>
            {detail}
          </Text>
        ) : null}
      </View>
    </PressableSurface>
  )
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center", alignSelf: "stretch" },
  label: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  spread: { justifyContent: "space-between" },
  // The label wraps rather than pushing the price out of the button.
  shrink: { flexShrink: 1 },
  whole: { flexShrink: 0 },
  hidden: { opacity: 0 },
})
