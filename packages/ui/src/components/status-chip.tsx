import { StyleSheet, View } from "react-native"
import { useTheme } from "../theme"
import type { StatusTone } from "../tokens"
import { Icon, type IconName } from "./icon"
import { Text } from "./text"

const ICONS: Record<StatusTone, IconName> = {
  neutral: "clock",
  info: "box",
  success: "check",
  warning: "info",
  danger: "x",
  new: "clock",
}

export type StatusChipProps = {
  label: string
  tone?: StatusTone
  /** Overrides the tone's default icon. */
  icon?: IconName
}

/** Always pairs an icon and a label with colour, so status never relies on colour alone. */
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
