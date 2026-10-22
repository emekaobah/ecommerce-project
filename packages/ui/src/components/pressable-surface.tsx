import { useState, type ReactNode } from "react"
import { Platform, Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native"
import { useTheme } from "../theme"

export type PressableSurfaceProps = Omit<PressableProps, "style" | "children"> & {
  style?: StyleProp<ViewStyle>
  children: ReactNode
  /** Draws the focus ring inside the shape (rows edge to edge) rather than outside it. */
  ringInset?: boolean
}

/**
 * What every pressable control shares (Foundations, Component states): pressed, an ink overlay
 * at 12% that shows at once (a ripple in that colour on Android); focused, a 4pt ring outside
 * the shape. Neither changes the control's size.
 */
export function PressableSurface({ style, children, ringInset, disabled, onFocus, onBlur, ...rest }: Readonly<PressableSurfaceProps>) {
  const theme = useTheme()
  const [focused, setFocused] = useState(false)
  const ring = `${ringInset ? "inset " : ""}0px 0px 0px ${theme.line.ring}px ${theme.colors.ring}`
  return (
    <Pressable
      {...rest}
      disabled={disabled}
      android_ripple={disabled ? undefined : { color: theme.colors.pressed }}
      onFocus={(event) => {
        setFocused(true)
        onFocus?.(event)
      }}
      onBlur={(event) => {
        setFocused(false)
        onBlur?.(event)
      }}
      style={[styles.surface, style, focused ? { boxShadow: ring } : null]}
    >
      {({ pressed }) => (
        <>
          {pressed && Platform.OS !== "android" ? (
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.pressed }]} />
          ) : null}
          {children}
        </>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  surface: { overflow: "hidden" },
})
