import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native"
import { useTheme } from "../theme"
import { Text, type TextTone } from "./text"

export type ButtonVariant = "primary" | "secondary" | "link"

export type ButtonProps = {
  label: string
  onPress: () => void
  variant?: ButtonVariant
  /** Right-aligned detail in the label, e.g. the price on "Place order". */
  detail?: string
  disabled?: boolean
  loading?: boolean
  style?: StyleProp<ViewStyle>
}

const TEXT_TONES: Record<ButtonVariant, TextTone> = { primary: "inverse", secondary: "default", link: "accent" }

/** Primary is a full-width ink fill; secondary is outlined in ink; link is Oja blue text. */
export function Button({ label, onPress, variant = "primary", detail, disabled, loading, style }: Readonly<ButtonProps>) {
  const theme = useTheme()
  const inactive = disabled || loading
  const textTone = TEXT_TONES[variant]
  const containers: Record<ButtonVariant, ViewStyle> = {
    primary: { backgroundColor: theme.colors.ink },
    secondary: { borderWidth: 1.5, borderColor: theme.colors.ink },
    link: {},
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { minHeight: theme.touchTarget, borderRadius: theme.radius.md, paddingHorizontal: theme.space.md },
        containers[variant],
        (pressed || inactive) && styles.dimmed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? theme.colors.onInk : theme.colors.ink} />
      ) : (
        <View style={[styles.content, detail ? styles.spread : null]}>
          <Text variant="label" tone={textTone}>
            {label}
          </Text>
          {detail ? (
            <Text variant="label" tone={textTone}>
              {detail}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center", alignSelf: "stretch" },
  spread: { justifyContent: "space-between" },
  dimmed: { opacity: 0.6 },
})
