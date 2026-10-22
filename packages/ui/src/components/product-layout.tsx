import { Children, isValidElement, type ReactNode } from "react"
import { ScrollView, StyleSheet, useWindowDimensions, View } from "react-native"
import { useTheme } from "../theme"
import { MAX_FONT_SCALE } from "../tokens"

/**
 * How many columns a product grid has: two, or one once the system text size reaches the cap
 * text grows to, so names and prices wrap instead of squeezing. For a FlatList's `numColumns`
 * (give the list a `key` with it, since a FlatList can't change columns in place).
 */
export function useGridColumns(): 1 | 2 {
  const { fontScale } = useWindowDimensions()
  return fontScale >= MAX_FONT_SCALE ? 1 : 2
}

/** Product tiles two to a row, inside the screen gutter; one to a row at large text sizes. */
export function ProductGrid({ children }: Readonly<{ children: ReactNode }>) {
  const theme = useTheme()
  const columns = useGridColumns()
  const tiles = Children.toArray(children)
  const rows = Array.from({ length: Math.ceil(tiles.length / columns) }, (_, row) => tiles.slice(row * columns, (row + 1) * columns))
  return (
    <View style={{ paddingHorizontal: theme.space[4], gap: theme.space[4] }}>
      {rows.map((row) => (
        <View key={keyOf(row[0])} style={[styles.row, { gap: theme.space[3] }]}>
          {row.map((tile) => (
            <View key={keyOf(tile)} style={styles.cell}>
              {tile}
            </View>
          ))}
          {/* An odd last tile keeps its column's width. */}
          {row.length < columns ? <View style={styles.cell} /> : null}
        </View>
      ))}
    </View>
  )
}

/** A tile's key, which Children.toArray gives every element. */
const keyOf = (tile: ReturnType<typeof Children.toArray>[number] | undefined) =>
  isValidElement(tile) && tile.key !== null ? tile.key : String(tile)

/** Product tiles in a row that scrolls sideways, starting at the screen gutter. */
export function ProductRail({ children, label }: Readonly<{ children: ReactNode; label?: string }>) {
  const theme = useTheme()
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={label}
      contentContainerStyle={[styles.row, { paddingHorizontal: theme.space[4], gap: theme.space[3] }]}
    >
      {Children.map(children, (tile) => (
        <View style={{ width: theme.block.railTile }}>{tile}</View>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start" },
  cell: { flex: 1 },
})
