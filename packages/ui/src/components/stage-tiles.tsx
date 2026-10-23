import { stageCountLabel } from "@oja/domain"
import { StyleSheet, View } from "react-native"
import { FONT_FACES } from "../fonts"
import { useTheme } from "../theme"
import { PressableSurface } from "./pressable-surface"
import { Text } from "./text"

/** A stage's tile: "New" with how many orders are in it; null while the count loads. */
export type StageTile<K extends string = string> = { key: K; label: string; count: number | null }

export type StageTilesProps<K extends string = string> = {
  stages: readonly StageTile<K>[]
  selected: K
  onSelect: (key: K) => void
}

/** "2 New orders", "1 Ready order": what VoiceOver reads for a tile, the full count however many. */
const spoken = ({ label, count }: StageTile) =>
  count === null ? `${label} orders, loading` : `${count} ${label} ${count === 1 ? "order" : "orders"}`

/**
 * The vendor app's stage tiles: four equal tiles, each a stage's count over its name, the
 * selected one filled indigo in both themes. Counts above 99 show as 99+ and never wrap; a
 * count still loading shows as a dot.
 */
export function StageTiles<K extends string>({ stages, selected, onSelect }: Readonly<StageTilesProps<K>>) {
  const theme = useTheme()
  return (
    <View accessibilityRole="tablist" style={[styles.row, { gap: theme.space[2] }]}>
      {stages.map((stage) => {
        const on = stage.key === selected
        const ink = on ? theme.colors.onBand : theme.colors.muted
        return (
          <PressableSurface
            key={stage.key}
            accessibilityRole="tab"
            accessibilityLabel={spoken(stage)}
            accessibilityState={{ selected: on }}
            onPress={() => onSelect(stage.key)}
            style={[
              styles.tile,
              {
                minHeight: theme.hitArea,
                padding: theme.space[2],
                borderRadius: theme.radius.md,
                backgroundColor: on ? theme.colors.band : theme.colors.tile,
              },
            ]}
          >
            <Text
              numberOfLines={1}
              tabular
              // The display face at the catalogue's 20px, as plain text: a display variant reads as a header.
              style={[theme.type.titlePushed, { fontFamily: FONT_FACES.display.extrabold, color: on ? theme.colors.onBand : theme.colors.ink }]}
            >
              {stage.count === null ? "·" : stageCountLabel(stage.count)}
            </Text>
            <Text variant="label" numberOfLines={1} style={{ color: ink }}>
              {stage.label}
            </Text>
          </PressableSurface>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: "row" },
  tile: { flex: 1, minWidth: 0, overflow: "hidden" },
})
