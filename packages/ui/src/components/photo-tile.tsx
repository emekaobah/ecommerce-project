import type { ReactNode } from "react"
import { StyleSheet, View, type ViewProps } from "react-native"
import { useTheme } from "../theme"

export type PhotoTileProps = ViewProps & {
  /** The product photo, or a placeholder when there is none. */
  children?: ReactNode
  /** Drawn over the veil, so it keeps its own colours in dark: add and save buttons, badges, carousel dots. */
  overlay?: ReactNode
}

/**
 * The white tile a product photo sits on, with no outline (#102). In dark a veil of the page
 * colour lies over the tile and its photo together, so white lands near #D8D8DC instead of
 * glaring, and a pack shot's baked-in white still meets the tile exactly. The size, corners and
 * padding are the caller's. Not for the pickup QR, which stays black on white.
 */
export function PhotoTile({ children, overlay, style, ...props }: Readonly<PhotoTileProps>) {
  const theme = useTheme()
  return (
    <View {...props} style={[styles.tile, { backgroundColor: theme.colors.productTile }, style]}>
      {children}
      {theme.colors.photoVeil ? <View style={[styles.veil, { backgroundColor: theme.colors.photoVeil }]} /> : null}
      {overlay}
    </View>
  )
}

const styles = StyleSheet.create({
  tile: { overflow: "hidden" },
  veil: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, pointerEvents: "none" },
})
