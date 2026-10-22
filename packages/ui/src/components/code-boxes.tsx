import { useState, type Ref } from "react"
import { StyleSheet, TextInput, View, type TextInputInstance } from "react-native"
import { useTheme } from "../theme"
import { focusRing, type Theme } from "../tokens"
import { Text } from "./text"

export type CodeBoxesProps = {
  /** What the code is, spoken and shown above it: "The buyer's 6-digit code". */
  label: string
  value: string
  onChangeText: (code: string) => void
  length?: number
  /** The code was wrong: every box takes a danger outline (say why under it). */
  error?: boolean
  disabled?: boolean
  autoFocus?: boolean
  ref?: Ref<TextInputInstance>
}

/**
 * A code typed one digit to a box, spread across the width. One hidden input takes the typing,
 * so paste and one-time-code autofill work, and screen readers hear one field. The next box
 * to fill shows the focus outline and ring.
 */
export function CodeBoxes({ label, value, onChangeText, length = 6, error, disabled, autoFocus, ref }: Readonly<CodeBoxesProps>) {
  const theme = useTheme()
  const [focused, setFocused] = useState(Boolean(autoFocus))
  const digits = Array.from({ length }, (_, index) => value[index] ?? "")

  return (
    <View style={{ gap: theme.space[1] }}>
      <Text variant="meta" weight="bold" tone="muted">
        {label}
      </Text>
      <View style={[styles.row, { gap: theme.space[2] }]}>
        {digits.map((digit, index) => {
          const next = focused && index === Math.min(value.length, length - 1)
          return (
            <View
              // The boxes are positions in the code.
              key={`box-${index}`}
              style={[
                styles.box,
                {
                  height: theme.block.codeBox,
                  borderRadius: theme.radius.md,
                  borderWidth: theme.line.input,
                  borderColor: boxOutline(theme, { error, disabled, next }),
                  backgroundColor: disabled ? theme.colors.tile : theme.colors.raised,
                },
                next && !error ? { boxShadow: focusRing(theme) } : null,
              ]}
            >
              <Text variant="titleNamed" tabular accessibilityElementsHidden importantForAccessibility="no">
                {digit}
              </Text>
            </View>
          )
        })}
        <TextInput
          ref={ref}
          value={value}
          onChangeText={(text) => onChangeText(text.replaceAll(/\D/g, "").slice(0, length))}
          editable={!disabled}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={length}
          caretHidden
          accessibilityLabel={label}
          accessibilityState={{ disabled }}
          style={[StyleSheet.absoluteFill, styles.input]}
        />
      </View>
    </View>
  )
}

function boxOutline(theme: Theme, box: { error?: boolean; disabled?: boolean; next: boolean }) {
  if (box.disabled) return "transparent"
  if (box.error) return theme.colors.danger
  return box.next ? theme.colors.accent : theme.colors.control
}

const styles = StyleSheet.create({
  row: { flexDirection: "row" },
  box: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center" },
  // Invisible but still tappable, so a tap anywhere on the boxes focuses it.
  input: { opacity: 0, color: "transparent" },
})
