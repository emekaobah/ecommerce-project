import { StyleSheet, View } from "react-native"
import { useTheme } from "../theme"
import type { StatusTone } from "../tokens"
import { Text } from "./text"

const SYMBOLS: Record<StatusTone, string> = {
  neutral: "○",
  info: "●",
  success: "✓",
  warning: "!",
  danger: "✕",
}

export type StatusChipProps = {
  label: string
  tone?: StatusTone
  /** Overrides the tone's default symbol. */
  symbol?: string
}

/** Always pairs a symbol and a label with colour, so status never relies on colour alone. */
export function StatusChip({ label, tone = "neutral", symbol = SYMBOLS[tone] }: Readonly<StatusChipProps>) {
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
          paddingHorizontal: theme.space.sm + theme.space.xs,
          paddingVertical: theme.space.xs,
          gap: theme.space.xs,
        },
      ]}
    >
      <Text variant="caption" style={[styles.strong, { color: foreground }]} importantForAccessibility="no">
        {symbol}
      </Text>
      <Text variant="caption" style={[styles.strong, { color: foreground }]}>
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start" },
  strong: { fontWeight: "700" },
})
