import type { ReactNode } from "react"
import { StyleSheet, View } from "react-native"
import { haptics } from "../haptics"
import { useTheme } from "../theme"
import { PressableSurface } from "./pressable-surface"
import { Text } from "./text"

export type RadioOptionProps = {
  selected: boolean
  disabled?: boolean
  /** Why it can't be chosen, shown under it while disabled. */
  disabledReason?: string
  onPress: () => void
  /** The option's words; while disabled, give them the muted tone. */
  children: ReactNode
  /** At the row's end, e.g. a price or a "Best value" tag. */
  trailing?: ReactNode
}

/**
 * One option of a radio group: a radio mark beside its content. Chosen, an accent outline and
 * the selected fill; disabled, muted with the reason under it. Choosing plays a selection haptic.
 */
export function RadioOption({ selected, disabled, disabledReason, onPress, children, trailing }: Readonly<RadioOptionProps>) {
  const theme = useTheme()
  const mark = theme.icon.size.chip
  return (
    <PressableSurface
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityHint={disabled ? disabledReason : undefined}
      disabled={disabled}
      onPress={() => {
        haptics.selection()
        onPress()
      }}
      style={[
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
      <View style={[styles.content, { gap: theme.space[1] }]}>
        {children}
        {disabled && disabledReason ? (
          <Text variant="meta" tone="muted">
            {disabledReason}
          </Text>
        ) : null}
      </View>
      {trailing}
    </PressableSurface>
  )
}

const styles = StyleSheet.create({
  option: { flexDirection: "row", alignItems: "center" },
  content: { flex: 1 },
})
