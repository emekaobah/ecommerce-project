import type { StatusTone } from "@oja/domain"
import { StyleSheet, View } from "react-native"
import { useTheme } from "../theme"
import { Icon, type IconName } from "./icon"
import { Text } from "./text"

const ICONS: Record<StatusTone, IconName> = {
  neutral: "x",
  info: "box",
  success: "check",
  new: "clock",
  attention: "info",
  danger: "alert",
}

export type StatusChipProps = {
  label: string
  tone?: StatusTone
  /** The status's own symbol (`@oja/domain` gives one with each label); otherwise the tone's. */
  icon?: IconName
}

/**
 * A status as `@oja/domain` words it: `<StatusChip {...orderStatus(order)} />`. Always pairs a
 * symbol and a label with the colour, so status never relies on colour alone. Ember
 * (`attention`) is only for what waits on the buyer and a new order's last two hours to accept.
 */
export function StatusChip({ label, tone = "neutral", icon = ICONS[tone] }: Readonly<StatusChipProps>) {
  const theme = useTheme()
  const { foreground, background } = theme.status[tone]
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[
        styles.chip,
        {
          backgroundColor: background,
          borderRadius: theme.radius.pill,
          paddingHorizontal: theme.space[2],
          paddingVertical: theme.space[1],
          gap: theme.space[1],
        },
      ]}
    >
      <Icon name={icon} use="chip" color={foreground} />
      <Text variant="label" weight="extrabold" style={{ color: foreground }}>
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start" },
})
