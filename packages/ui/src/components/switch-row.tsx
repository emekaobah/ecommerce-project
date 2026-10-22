import { StyleSheet, Switch, View } from "react-native"
import { haptics } from "../haptics"
import { useTheme } from "../theme"
import { Text } from "./text"

export type SwitchRowProps = {
  label: string
  /** What turning it on does. */
  description?: string
  value: boolean
  onValueChange: (value: boolean) => void
  disabled?: boolean
  /** Why it can't be changed, shown under it while disabled: "Only owners and managers can pause orders." */
  disabledReason?: string
}

/** A setting that is on or off: its words, and the platform's own switch, leaf when on. */
export function SwitchRow({ label, description, value, onValueChange, disabled, disabledReason }: Readonly<SwitchRowProps>) {
  const theme = useTheme()
  const reason = disabled ? disabledReason : undefined
  return (
    <View style={[styles.row, { minHeight: theme.hitArea, gap: theme.space[3], paddingVertical: theme.space[3] }]}>
      <View style={[styles.text, { gap: theme.space[1] }]}>
        <Text weight="bold" tone={disabled ? "muted" : "default"}>
          {label}
        </Text>
        {description ? (
          <Text variant="meta" tone="muted">
            {description}
          </Text>
        ) : null}
        {reason ? (
          <Text variant="meta" tone="muted">
            {reason}
          </Text>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityHint={[description, reason].filter(Boolean).join(" ") || undefined}
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          haptics.selection()
          onValueChange(next)
        }}
        trackColor={{ false: theme.colors.control, true: theme.colors.leaf }}
        ios_backgroundColor={theme.colors.control}
        thumbColor={theme.colors.onPrimary}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  text: { flex: 1 },
})
