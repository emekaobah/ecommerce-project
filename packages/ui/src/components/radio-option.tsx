import type { ReactNode } from "react"
import { Pressable, StyleSheet, View } from "react-native"
import { useTheme } from "../theme"

export type RadioOptionProps = {
  selected: boolean
  disabled?: boolean
  onPress: () => void
  children: ReactNode
}

/** One option of a radio group: a radio mark beside its content; chosen, an accent outline and the selected fill. */
export function RadioOption({ selected, disabled, onPress, children }: Readonly<RadioOptionProps>) {
  const theme = useTheme()
  const mark = theme.icon.size.chip
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      android_ripple={{ color: theme.colors.pressed }}
      style={({ pressed }) => [
        styles.option,
        {
          minHeight: theme.hitArea,
          padding: theme.space[3],
          gap: theme.space[2],
          borderRadius: theme.radius.md,
          borderWidth: theme.line.input,
          borderColor: selected ? theme.colors.accent : theme.colors.control,
          backgroundColor: selected ? theme.colors.selected : theme.colors.raised,
        },
        pressed && { backgroundColor: theme.colors.pressed },
      ]}
    >
      <View
        style={{
          width: mark,
          height: mark,
          borderRadius: mark / 2,
          borderWidth: selected ? mark * 0.3 : theme.line.input,
          borderColor: selected ? theme.colors.accent : theme.colors.control,
        }}
      />
      <View style={[styles.content, { gap: theme.space[1] }]}>{children}</View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  option: { flexDirection: "row", alignItems: "center" },
  content: { flex: 1 },
})
