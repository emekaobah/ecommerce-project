import type { ReactNode } from "react"
import { Pressable, StyleSheet, View } from "react-native"
import { useTheme } from "../theme"
import { Text } from "./text"

export type ListRowProps = {
  title: string
  subtitle?: string
  /** e.g. a thumbnail or icon. */
  leading?: ReactNode
  /** e.g. a price, status chip or chevron. */
  trailing?: ReactNode
  onPress?: () => void
}

export function ListRow({ title, subtitle, leading, trailing, onPress }: Readonly<ListRowProps>) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: theme.touchTarget,
          gap: theme.space.md,
          paddingVertical: theme.space.sm + theme.space.xs,
          borderBottomColor: theme.colors.divider,
        },
        pressed && { backgroundColor: theme.colors.surface },
      ]}
    >
      {leading}
      <View style={styles.text}>
        <Text variant="label" numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="secondary" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  text: { flex: 1, gap: 2 },
})
