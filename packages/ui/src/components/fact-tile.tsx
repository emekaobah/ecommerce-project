import { StyleSheet, View } from "react-native"
import { useTheme } from "../theme"
import { Icon, type IconName } from "./icon"
import { Text } from "./text"

export type FactTileProps = {
  /** The fact, in bold: "Arrives Thu 23 Oct", "Pick up". */
  value: string
  /** What it costs or means, under it: "₦1,800 delivery", "Surulere · free". */
  label: string
  /** A symbol above, in the accent colour. */
  icon?: IconName
}

/** One fact that decides a purchase, on a Mist tile: delivery, pickup, the shop's hours. Read as one item. */
export function FactTile({ value, label, icon }: Readonly<FactTileProps>) {
  const theme = useTheme()
  return (
    <View
      accessible
      accessibilityLabel={`${value}, ${label}`}
      style={[styles.tile, { backgroundColor: theme.colors.tile, borderRadius: theme.radius.md, padding: theme.space[2], gap: theme.space[1] }]}
    >
      {icon ? <Icon name={icon} use="step" color={theme.colors.accent} /> : null}
      <Text weight="bold">{value}</Text>
      <Text variant="meta" tone="muted">
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  tile: { flex: 1 },
})
