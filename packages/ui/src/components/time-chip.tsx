import { useEffect, useRef, useState, type ComponentType } from "react"
import { Animated, Easing, StyleSheet, View } from "react-native"
import Svg, { Path, type PathProps } from "react-native-svg"
import { useReduceMotion, useTheme } from "../theme"
import { SCALE } from "../tokens"
import { Icon } from "./icon"
import { Text } from "./text"

// react-native-svg's class types come from an older @types/react than Animated's.
const AnimatedPath = Animated.createAnimatedComponent(Path as unknown as ComponentType<PathProps>)

/** The chip's height and the ring's stroke, in mockup px. */
const HEIGHT = 30
const STROKE = 2.5
/** The ring drains over a second as the clock ticks on, unless Reduce Motion is on. */
const DRAIN_MS = 1000

export type TimeChipProps = {
  /** "1h 48m left", from `acceptTimeLeft`. */
  label: string
  /** How much of the time to accept is left, 0 to 1, from `acceptClockFraction`: the ring's length. */
  fraction: number
  /** The last two open hours: ember instead of sun. */
  urgent: boolean
  /** What VoiceOver reads: "1h 48m left to accept". */
  accessibilityLabel: string
}

/**
 * A rounded rectangle traced clockwise from the middle of its top edge, so the ring drains back
 * towards the top as the time runs out.
 */
function ringPath(width: number, height: number, inset: number) {
  const left = inset
  const top = inset
  const right = width - inset
  const bottom = height - inset
  const r = Math.min((bottom - top) / 2, (right - left) / 2)
  const mid = width / 2
  const path =
    `M ${mid} ${top} H ${right - r} A ${r} ${r} 0 0 1 ${right} ${top + r} V ${bottom - r} ` +
    `A ${r} ${r} 0 0 1 ${right - r} ${bottom} H ${left + r} A ${r} ${r} 0 0 1 ${left} ${bottom - r} ` +
    `V ${top + r} A ${r} ${r} 0 0 1 ${left + r} ${top} Z`
  const length = 2 * (right - left - 2 * r) + 2 * (bottom - top - 2 * r) + 2 * Math.PI * r
  return { path, length }
}

/**
 * A new order's accept clock: the time left, in sun, turning ember in the last two open hours,
 * with an outline that drains with the open time left. The outline holds still under Reduce
 * Motion; it never carries the meaning alone, the label does.
 */
export function TimeChip({ label, fraction, urgent, accessibilityLabel }: Readonly<TimeChipProps>) {
  const theme = useTheme()
  const reduceMotion = useReduceMotion()
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const { foreground, background } = theme.status[urgent ? "attention" : "new"]
  const left = Math.max(0, Math.min(1, fraction))
  const drawn = useRef(new Animated.Value(left)).current

  useEffect(() => {
    if (reduceMotion) {
      drawn.setValue(left)
      return
    }
    const drain = Animated.timing(drawn, { toValue: left, duration: DRAIN_MS, easing: Easing.linear, useNativeDriver: false })
    drain.start()
    return () => drain.stop()
  }, [drawn, left, reduceMotion])

  const stroke = Math.round(STROKE * SCALE)
  const ring = size ? ringPath(size.width, size.height, stroke / 2) : null

  return (
    <View
      accessible
      accessibilityRole="timer"
      accessibilityLabel={accessibilityLabel}
      onLayout={({ nativeEvent: { layout } }) => setSize({ width: layout.width, height: layout.height })}
      style={[
        styles.chip,
        {
          minHeight: Math.round(HEIGHT * SCALE),
          backgroundColor: background,
          borderRadius: theme.radius.pill,
          paddingHorizontal: theme.space[3],
          paddingVertical: theme.space[1],
          gap: theme.space[1],
        },
      ]}
    >
      {ring ? (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <Path d={ring.path} fill="none" stroke={theme.colors.clockTrack} strokeWidth={stroke} />
          {left > 0 ? (
            <AnimatedPath
            d={ring.path}
            fill="none"
            stroke={urgent ? theme.colors.clockRingUrgent : theme.colors.clockRing}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={[ring.length, ring.length]}
            // Shifting the dash by the time gone leaves the time left drawn from the top.
              strokeDashoffset={drawn.interpolate({ inputRange: [0, 1], outputRange: [ring.length, 0] })}
            />
          ) : null}
        </Svg>
      ) : null}
      <Icon name="clock" use="chip" color={foreground} />
      <Text variant="label" weight="extrabold" tabular style={{ color: foreground }}>
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", flexShrink: 0 },
})
