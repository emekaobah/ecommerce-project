import { StyleSheet, View } from "react-native"
import { useTheme } from "../theme"
import { Text } from "./text"

export type DealBadgeProps = {
  /** The shop's deal in words, from `@oja/domain` `dealLabel`: "10% off at this shop". */
  label: string
}

/**
 * A shop's automatic promotion on its product (ADR 0014): a sun pill with dark text in both
 * themes. Only ever that shop's own deal, as the store returns it; no badge compares shops.
 */
export function DealBadge({ label }: Readonly<DealBadgeProps>) {
  const theme = useTheme()
  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: theme.colors.sun,
          borderRadius: theme.radius.pill,
          paddingHorizontal: theme.space[2],
          paddingVertical: theme.space[1],
        },
      ]}
    >
      <Text variant="label" weight="extrabold" style={{ color: theme.colors.onSun }}>
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: { alignSelf: "flex-start" },
})
