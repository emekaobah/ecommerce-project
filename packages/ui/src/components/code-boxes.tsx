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
 * so paste and one-time-code autofill work, and screen readers hear one field, its digits read
 * one by one with how many are left to type. The next box
 * to fill shows the focus outline and ring.
 */
export function CodeBoxes({ label, value, onChangeText, length = 6, error, disabled, autoFocus, ref }: Readonly<CodeBoxesProps>) {
  const theme = useTheme()
  const [focused, setFocused] = useState(Boolean(autoFocus))
  // Each box is a position in the code, which is its key.
  const boxes = Array.from({ length }, (_, position) => ({ position, digit: value[position] ?? "" }))

  return (
    <View style={{ gap: theme.space[1] }}>
      {/* The input carries the label, so it is read once, with the field. */}
      <Text variant="meta" weight="bold" tone="muted" accessibilityElementsHidden importantForAccessibility="no">
        {label}
      </Text>
      <View style={[styles.row, { gap: theme.space[2] }]}>
        {boxes.map(({ position, digit }) => {
          const next = focused && position === Math.min(value.length, length - 1)
          return (
            <View
              key={position}
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
          // Read digit by digit ("4 8 2"), never as one number, and how many are left to type.
          accessibilityValue={{ text: spokenCode(value, length) }}
          accessibilityState={{ disabled }}
          style={[StyleSheet.absoluteFill, styles.input]}
        />
      </View>
    </View>
  )
}

/** "4 8 2, 3 more digits": what is typed so far, as a screen reader says it. */
function spokenCode(value: string, length: number) {
  const left = length - value.length
  const typed = value.split("").join(" ")
  if (!left) return typed
  const more = `${left} ${value ? "more " : ""}${left === 1 ? "digit" : "digits"}`
  return typed ? `${typed}, ${more}` : more
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
