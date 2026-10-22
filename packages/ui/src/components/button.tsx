import { ActivityIndicator, Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native"
import { useTheme } from "../theme"
import type { Theme } from "../tokens"
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

/**
 * Primary is the one indigo action on a screen; secondary is Mist; danger is for destructive
 * actions only; link is text. Disabled turns the fill to Mist with a muted label (never faded),
 * and loading swaps the label for a spinner at the same size, keeping a price beside it.
 */
export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  detail,
  disabled,
  loading,
  style,
}: Readonly<ButtonProps>) {
  const theme = useTheme()
  const inactive = disabled || loading
  const isLink = variant === "link"
  const fill = disabled && !isLink ? theme.colors.tile : fills(theme)[variant]
  const tone: TextTone = disabled ? "muted" : LABEL_TONES[variant]
  const spinner = variant === "primary" || variant === "danger" ? theme.colors.onPrimary : theme.colors.ink

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      android_ripple={isLink ? undefined : { color: theme.colors.pressed }}
      style={[
        styles.base,
        {
          minHeight: isLink ? theme.hitArea : theme.control[size],
          borderRadius: theme.radius.lg,
          paddingHorizontal: isLink ? 0 : theme.space[4],
          backgroundColor: fill,
        },
        style,
      ]}
    >
      {({ pressed }) => (
        <>
          {pressed && Platform.OS === "ios" ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.pressed }]} />
          ) : null}
          <View style={[styles.content, { gap: theme.space[2] }, detail ? styles.spread : null]}>
            {loading ? (
              <ActivityIndicator color={spinner} accessibilityLabel={label} />
            ) : (
              <Text variant="strong" tone={tone} style={isLink && styles.underline}>
                {label}
              </Text>
            )}
            {detail ? (
              <Text variant="strong" tone={tone} tabular>
                {detail}
              </Text>
            ) : null}
          </View>
        </>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center", alignSelf: "stretch" },
  spread: { justifyContent: "space-between" },
  underline: { textDecorationLine: "underline" },
})
