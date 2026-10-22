import { useRef, useState, type ReactNode } from "react"
import { Animated, Platform, Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from "react-native"
import { useTheme } from "../theme"
import { focusRing } from "../tokens"

export type PressableSurfaceProps = Omit<PressableProps, "style" | "children"> & {
  style?: StyleProp<ViewStyle>
  children: ReactNode
  /** Draws the focus ring 2pt inside the shape (rows edge to edge) rather than 4pt outside it. */
  ringInset?: boolean
}

/**
 * What every pressable control shares (Foundations, Component states and Motion): pressed, an
 * ink overlay at 12% that shows at once and fades over 100ms (a ripple in that colour on
 * Android); focused, the focus ring. Neither changes the control's size.
 */
export function PressableSurface({
  style,
  children,
  ringInset,
  disabled,
  onFocus,
  onBlur,
  onPressIn,
  onPressOut,
  ...rest
}: Readonly<PressableSurfaceProps>) {
  const theme = useTheme()
  const [focused, setFocused] = useState(false)
  const overlay = useRef(new Animated.Value(0)).current
  const ios = Platform.OS !== "android"

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      android_ripple={disabled ? undefined : { color: theme.colors.pressed }}
      onPressIn={(event) => {
        overlay.stopAnimation()
        overlay.setValue(1)
        onPressIn?.(event)
      }}
      onPressOut={(event) => {
        Animated.timing(overlay, { toValue: 0, duration: theme.motion.press, useNativeDriver: true }).start()
        onPressOut?.(event)
      }}
      onFocus={(event) => {
        setFocused(true)
        onFocus?.(event)
      }}
      onBlur={(event) => {
        setFocused(false)
        onBlur?.(event)
      }}
      style={[styles.surface, style, focused ? { boxShadow: focusRing(theme, ringInset) } : null]}
    >
      {ios ? (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.pressed, opacity: overlay }]}
        />
      ) : null}
      {children}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  surface: { overflow: "hidden" },
})
