import { useState, type Ref } from "react"
import { StyleSheet, TextInput, View, type TextInputInstance, type TextInputProps } from "react-native"
import { useTheme } from "../theme"
import { focusRing, MAX_FONT_SCALE, type Theme } from "../tokens"
import { Icon } from "./icon"
import { Text } from "./text"

export type TextFieldProps = Omit<TextInputProps, "style" | "editable"> & {
  label: string
  /** Adds "(optional)" after the label. */
  optional?: boolean
  /** Reads the label out but doesn't show it, where a heading above already asks for the field (Reject's "Why can't you take it?"). */
  labelHidden?: boolean
  /** A line under the field that helps fill it in. */
  hint?: string | null
  /** What's wrong with what was typed, in plain words; replaces the hint. */
  error?: string | null
  disabled?: boolean
  ref?: Ref<TextInputInstance>
}

/**
 * A labelled input. Focused, an accent outline with a 4pt ring; with an error, a danger outline
 * and the message under it after an alert icon; disabled, a Mist fill with no outline.
 */
export function TextField({ label, optional, labelHidden, hint, error, disabled, multiline, onFocus, onBlur, ref, ...input }: Readonly<TextFieldProps>) {
  const theme = useTheme()
  const [focused, setFocused] = useState(false)
  const note = error ?? hint

  return (
    <View style={{ gap: theme.space[1] }}>
      {labelHidden ? null : (
        <Text variant="meta" weight="bold" tone="muted">
          {label}
          {optional ? <Text variant="meta" tone="muted">{" (optional)"}</Text> : null}
        </Text>
      )}
      <TextInput
        {...input}
        ref={ref}
        editable={!disabled}
        multiline={multiline}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        accessibilityLabel={optional ? `${label}, optional` : label}
        accessibilityHint={note ?? undefined}
        accessibilityState={{ disabled }}
        placeholderTextColor={theme.colors.muted}
        onFocus={(event) => {
          setFocused(true)
          onFocus?.(event)
        }}
        onBlur={(event) => {
          setFocused(false)
          onBlur?.(event)
        }}
        style={[
          theme.type.body,
          styles.input,
          {
            minHeight: multiline ? theme.block.textArea : theme.control.md,
            paddingHorizontal: theme.space[3],
            paddingVertical: multiline ? theme.space[2] : 0,
            borderRadius: theme.radius.md,
            borderWidth: theme.line.input,
            borderColor: outlineOf(theme, { disabled, error: Boolean(error), focused }),
            color: disabled ? theme.colors.muted : theme.colors.ink,
            backgroundColor: disabled ? theme.colors.tile : theme.colors.raised,
          },
          multiline && styles.multiline,
          focused && !error ? { boxShadow: focusRing(theme) } : null,
        ]}
      />
      {error ? (
        <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.error, { gap: theme.space[1] }]}>
          <Icon name="alert" use="chip" color={theme.colors.dangerText} />
          <Text variant="meta" tone="danger" style={styles.fill}>
            {error}
          </Text>
        </View>
      ) : null}
      {hint && !error ? (
        <Text variant="meta" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  )
}

function outlineOf(theme: Theme, field: { disabled?: boolean; error: boolean; focused: boolean }) {
  if (field.disabled) return "transparent"
  if (field.error) return theme.colors.danger
  return field.focused ? theme.colors.accent : theme.colors.control
}

const styles = StyleSheet.create({
  input: { textAlignVertical: "center" },
  multiline: { textAlignVertical: "top" },
  error: { flexDirection: "row", alignItems: "flex-start" },
  fill: { flex: 1 },
})
