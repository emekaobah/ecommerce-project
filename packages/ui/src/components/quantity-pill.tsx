import { StyleSheet, View } from "react-native"
import { useTheme } from "../theme"
import { Text } from "./text"

export type QuantityPillTone = "neutral" | "picked" | "short" | "onBand"

export type QuantityPillProps = {
  /** "×2" on an order line, "2/2" on the pick list. */
  label: string
  tone?: QuantityPillTone
  /** Spoken instead of the label: "2 of 2 picked". Left out, the pill is read as part of its row. */
  accessibilityLabel?: string
}

/**
 * A line's quantity as a pill: mist; leaf once picked in full; ember while items are short; a
 * light wash on the indigo band (the new-order takeover). Bricolage, tabular figures.
 */
export function QuantityPill({ label, tone = "neutral", accessibilityLabel }: Readonly<QuantityPillProps>) {
  const theme = useTheme()
  const fills: Record<QuantityPillTone, { background: string; foreground: string }> = {
    neutral: { background: theme.colors.tile, foreground: theme.colors.ink },
    picked: { background: theme.colors.leaf, foreground: theme.colors.onPrimary },
    short: { background: theme.colors.ember, foreground: theme.colors.onPrimary },
    onBand: { background: theme.colors.onBandTile, foreground: theme.colors.onBand },
  }
  const { background, foreground } = fills[tone]
  return (
    <View
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.pill,
        { minWidth: theme.control.md, minHeight: theme.space[8], paddingHorizontal: theme.space[2], borderRadius: theme.radius.pill, backgroundColor: background },
      ]}
    >
      <Text variant="heading" tabular style={{ fontSize: theme.type.strong.fontSize, color: foreground }}>
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({ pill: { alignItems: "center", justifyContent: "center", flexShrink: 0 } })
