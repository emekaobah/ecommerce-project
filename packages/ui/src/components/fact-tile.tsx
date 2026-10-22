import { StyleSheet, View } from "react-native"
import { useTheme } from "../theme"
import { Icon, type IconName } from "./icon"
import { Text } from "./text"

export type FactTileProps = {
  /** What the fact is, e.g. "Delivery". */
  label: string
  /** The fact, e.g. "Arrives Thu 23 Oct". */
  value: string
  /** A symbol beside the label, in the accent colour. */
  icon?: IconName
}

/** One fact that decides a purchase, on a Mist tile: delivery, pickup, the shop's hours. */
export function FactTile({ label, value, icon }: Readonly<FactTileProps>) {
  const theme = useTheme()
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={[
        styles.tile,
        { backgroundColor: theme.colors.tile, borderRadius: theme.radius.md, padding: theme.space[2], gap: theme.space[1] },
      ]}
    >
      <View style={[styles.label, { gap: theme.space[1] }]}>
        {icon ? <Icon name={icon} use="chip" color={theme.colors.accent} /> : null}
        <Text variant="meta" tone="muted">
          {label}
        </Text>
      </View>
      <Text weight="bold">{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  tile: { flex: 1 },
  label: { flexDirection: "row", alignItems: "center" },
})
