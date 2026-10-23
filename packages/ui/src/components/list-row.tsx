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
  /** Red, for a row that ends something, like Sign out. */
  destructive?: boolean
}

/**
 * A row in a list. Rows are told apart by the space around them, with no divider lines
 * (design: lists, settings, totals); pressed, a row fills with Mist edge to edge.
 */
export function ListRow({ title, subtitle, leading, trailing, onPress, destructive }: Readonly<ListRowProps>) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      onPress={onPress}
      android_ripple={onPress ? { color: theme.colors.pressed } : undefined}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: theme.hitArea,
          gap: theme.space[3],
          paddingVertical: theme.space[4],
        },
        pressed && { backgroundColor: theme.colors.tile },
      ]}
    >
      {leading}
      <View style={[styles.text, { gap: theme.space[1] }]}>
        <Text weight="bold" tone={destructive ? "danger" : undefined}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="meta" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  text: { flex: 1 },
})
