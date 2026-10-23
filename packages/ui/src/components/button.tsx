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

/**
 * Primary is the one indigo action on a screen; secondary is Mist; danger is for destructive
 * actions only; link is text. Disabled turns the fill to Mist with a muted label (never faded).
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
  style,
}: Readonly<ButtonProps>) {
  const theme = useTheme()
  const inactive = disabled || loading
  const isLink = variant === "link"
  const fill = disabled && !isLink ? theme.colors.tile : fills(theme)[variant]
  const tone: TextTone = disabled ? "muted" : LABEL_TONES[variant]
  const ink = disabled ? theme.colors.muted : inks(theme)[variant]

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
            <Text variant="strong" tone={tone} style={[styles.shrink, isLink && styles.underline]}>
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
  underline: { textDecorationLine: "underline" },
  hidden: { opacity: 0 },
})
