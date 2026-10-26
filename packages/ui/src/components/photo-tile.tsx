import { StyleSheet, View, type ViewProps } from "react-native"
import { useTheme } from "../theme"

/**
 * The tile a product photo sits on, with no outline: white in light, charcoal in dark (#115).
 * Product photos are transparent cut-outs, so each sits straight on the tile's colour. Children
 * are the photo (or a placeholder), then anything drawn over it: buttons, badges, carousel dots.
 * The size, corners and padding are the caller's. Not for the pickup QR or shop logos, which sit
 * on white (`paper`) in both themes.
 */
export function PhotoTile({ style, ...props }: Readonly<ViewProps>) {
  const theme = useTheme()
  return <View {...props} style={[styles.tile, { backgroundColor: theme.colors.productTile }, style]} />
}

const styles = StyleSheet.create({
  tile: { overflow: "hidden" },
})
