import { ScrollView, StyleSheet } from "react-native"
import { useTheme } from "../theme"
import { PressableSurface } from "./pressable-surface"
import { Text } from "./text"

export type FilterChip = { id: string; label: string }

export type FilterChipsProps = {
  options: FilterChip[]
  /** The chosen option's id. */
  selected: string
  onSelect: (id: string) => void
  /** What the chips choose, for screen readers: "Categories". */
  label: string
}

/**
 * One choice from a row of chips that scrolls sideways from the screen gutter: Home's
 * categories, a category's sub-categories. The chosen chip is filled indigo; the others Mist.
 * Drawn 32 mockup px tall with a 44pt hit area.
 */
export function FilterChips({ options, selected, onSelect, label }: Readonly<FilterChipsProps>) {
  const theme = useTheme()
  const height = theme.space[8]
  const slop = Math.max(0, (theme.hitArea - height) / 2)
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={label}
      contentContainerStyle={[styles.row, { paddingHorizontal: theme.space[4], paddingVertical: slop, gap: theme.space[2] }]}
    >
      {options.map((option) => {
        const on = option.id === selected
        return (
          <PressableSurface
            key={option.id}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            hitSlop={{ top: slop, bottom: slop }}
            onPress={() => onSelect(option.id)}
            style={[
              styles.chip,
              {
                minHeight: height,
                paddingHorizontal: theme.space[3],
                borderRadius: theme.radius.md,
                backgroundColor: on ? theme.colors.primary : theme.colors.tile,
              },
            ]}
          >
            <Text variant="meta" weight="bold" style={{ color: on ? theme.colors.onPrimary : theme.colors.ink }}>
              {option.label}
            </Text>
          </PressableSurface>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  chip: { alignItems: "center", justifyContent: "center" },
})
