import type { ReactNode } from "react"
import { StyleSheet, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useTheme } from "../theme"
import { Button, type ButtonProps } from "./button"

export type StickyActionProps = Omit<ButtonProps, "size" | "detail"> & {
  /** The money it moves, at the button's right: "₦47,700". */
  price?: string
  /** Beside the button, e.g. the product's quantity stepper. */
  leading?: ReactNode
}

/**
 * A screen's one main action, pinned to the foot of the screen above the home indicator, with
 * the price in its label when money moves: "Checkout 2 shops · ₦47,700". Place it after the
 * scrolling content, outside the scroll view.
 */
export function StickyAction({ price, leading, style, ...button }: Readonly<StickyActionProps>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View
      style={[
        styles.bar,
        {
          gap: theme.space[2],
          paddingTop: theme.space[3],
          paddingHorizontal: theme.space[4],
          paddingBottom: Math.max(insets.bottom, theme.space[4]),
          backgroundColor: theme.colors.bg,
        },
      ]}
    >
      {leading}
      <Button {...button} size="main" detail={price} style={[styles.button, style]} />
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "flex-start" },
  button: { flex: 1 },
})
