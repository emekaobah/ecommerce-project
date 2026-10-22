import { useEffect, useRef, useState } from "react"
import { Animated, Easing, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native"
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg"
import { useReduceMotion, useTheme } from "../theme"
import type { radius } from "../tokens"

export type SkeletonProps = {
  width?: DimensionValue
  height: DimensionValue
  /** A corner token: "pill" for a line of text, "md" for a product photo. */
  radius?: keyof typeof radius
  style?: StyleProp<ViewStyle>
}

/**
 * A Mist block in the shape of content still loading, with a shimmer sweeping across it every
 * 1.4s. Under Reduce Motion it holds still. Hidden from screen readers: the screen says it is
 * loading once, not per block.
 */
export function Skeleton({ width = "100%", height, radius = "sm", style }: Readonly<SkeletonProps>) {
  const theme = useTheme()
  const reduceMotion = useReduceMotion()
  const [measured, setMeasured] = useState(0)

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => setMeasured(event.nativeEvent.layout.width)}
      style={[
        styles.block,
        { width, height, borderRadius: theme.radius[radius], backgroundColor: theme.colors.tile },
        style,
      ]}
    >
      {reduceMotion || !measured ? null : <Shimmer width={measured} color={theme.colors.shimmer} duration={theme.motion.shimmer} />}
    </View>
  )
}

function Shimmer({ width, color, duration }: Readonly<{ width: number; color: string; duration: number }>) {
  const sweep = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    )
    loop.start()
    return () => loop.stop()
  }, [sweep, duration])

  const translateX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-width, width] })
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX }] }]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="skeleton-shimmer" x1="0" y1="0" x2="1" y2="0">
            <Stop offset={0} stopColor={color} stopOpacity={0} />
            <Stop offset={0.5} stopColor={color} />
            <Stop offset={1} stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#skeleton-shimmer)" />
      </Svg>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  block: { overflow: "hidden" },
})
