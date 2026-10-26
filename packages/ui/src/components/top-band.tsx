import { topBand, topBandStatusBar } from "@oja/domain"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  StatusBar,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from "react-native"
import Animated, {
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { scheduleOnRN } from "react-native-worklets"
import { useTheme } from "../theme"
import { Band } from "./band"

/** What a screen spreads on its Reanimated scroll view or list so its top band can follow the scroll. */
export type TopBandScroll = {
  onScroll: ReturnType<typeof useAnimatedScrollHandler>
  scrollEventThrottle: number
}

/** A screen's top band: made by `useTopBand`, handed to `TopBandScreen`, the band and the scroll view. */
export type TopBandController = {
  scroll: TopBandScroll
  scrollY: SharedValue<number>
  /** The band's measured height from the screen's top edge, status bar included; 0 until laid out. */
  height: SharedValue<number>
}

/**
 * The scroll tracking for a screen that opens on the indigo band. The scroll offset and the band's
 * height live on the UI thread, so the strip's fade never waits on JavaScript.
 */
export function useTopBand(): TopBandController {
  const scrollY = useSharedValue(0)
  const height = useSharedValue(0)
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y)
  })
  return useMemo(() => ({ scroll: { onScroll, scrollEventThrottle: 16 }, scrollY, height }), [onScroll, scrollY, height])
}

/** One pixel of the indigo under the band's top edge, so pulling down never opens a seam between them. */
const OVERLAP = 1

export type TopBandScreenProps = {
  band: TopBandController
  /** Whether the screen is in front: only the focused screen sets the status bar. */
  focused: boolean
  /** The page under the band, and so the strip; the page colour unless the screen sits on another. */
  pageColor?: string
  children: ReactNode
}

/**
 * The page under a top band: indigo above the band's top edge for pulling down, the page-colour
 * strip that fades in behind the status bar as the band leaves, and the status bar itself, white
 * on the band and the theme's own once the band has cleared it. Scroll views inside stay
 * transparent; the page colour is drawn here.
 */
export function TopBandScreen({ band, focused, pageColor, children }: Readonly<TopBandScreenProps>) {
  const theme = useTheme()
  const page = pageColor ?? theme.colors.bg
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const scheme = useColorScheme() === "dark" ? "dark" : "light"
  const statusBarHeight = insets.top
  const { scrollY, height } = band
  const [cleared, setCleared] = useState(false)

  // The status bar changes once per crossing, not with every frame.
  useAnimatedReaction(
    () => topBand(scrollY.get(), height.get(), statusBarHeight).cleared,
    (now, before) => {
      if (now !== before) scheduleOnRN(setCleared, now)
    },
    [statusBarHeight],
  )
  const strip = useAnimatedStyle(() => ({ opacity: topBand(scrollY.get(), height.get(), statusBarHeight).stripOpacity }))
  // Pulled down, the indigo follows the band's top edge down the screen.
  const pull = useAnimatedStyle(() => ({ transform: [{ translateY: Math.max(0, -scrollY.get()) }] }))

  return (
    <View style={[styles.fill, { backgroundColor: page }]}>
      <Animated.View
        style={[styles.edge, { top: OVERLAP - windowHeight, height: windowHeight, backgroundColor: theme.colors.band }, pull]}
      />
      {children}
      <Animated.View
        style={[
          styles.edge,
          {
            top: 0,
            height: statusBarHeight,
            backgroundColor: page,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.line,
          },
          strip,
        ]}
      />
      {focused ? <StatusBar animated barStyle={`${topBandStatusBar(cleared, scheme)}-content`} /> : null}
    </View>
  )
}

/** The band's measurement, and a fresh list (the shop page's other tab) starts with the band at rest. */
function useTopBandLayout({ scrollY, height }: TopBandController) {
  useEffect(() => {
    scrollY.set(0)
  }, [scrollY])
  return (event: LayoutChangeEvent) => height.set(event.nativeEvent.layout.height)
}

export type TopBandProps = {
  band: TopBandController
  /** The space between the status bar and the band's content: the band's top padding (default `space[2]`). */
  belowStatusBar?: number
  /** The band's own style, all but its top padding. */
  style?: StyleProp<ViewStyle>
  children: ReactNode
}

/**
 * The indigo band at the top of a screen, under the status bar: the first thing in the screen's
 * scroll view (or on its own, for a screen that doesn't scroll), inside a `TopBandScreen`.
 */
export function TopBand({ band, belowStatusBar, style, children }: Readonly<TopBandProps>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const onLayout = useTopBandLayout(band)
  return (
    <Band onLayout={onLayout} style={[style, { paddingTop: insets.top + (belowStatusBar ?? theme.space[2]) }]}>
      {children}
    </Band>
  )
}

export type TopBandAreaProps = Omit<ViewProps, "onLayout"> & {
  band: TopBandController
  /** The space between the status bar and the area's content: its top padding (default none). */
  belowStatusBar?: number
}

/**
 * A top band drawn its own way (a shop's banner, a sign-in hero): measured like `TopBand` and
 * padded below the status bar, with its look left to the caller.
 */
export function TopBandArea({ band, belowStatusBar = 0, style, ...props }: Readonly<TopBandAreaProps>) {
  const insets = useSafeAreaInsets()
  const onLayout = useTopBandLayout(band)
  return <View {...props} onLayout={onLayout} style={[style, { paddingTop: insets.top + belowStatusBar }]} />
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  edge: { position: "absolute", left: 0, right: 0, pointerEvents: "none" },
})
