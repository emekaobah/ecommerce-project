import { StatusBar } from "expo-status-bar"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  StyleSheet,
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
import { topBandPosition } from "./top-band-position"

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

/**
 * The pull-to-refresh spinner's colours on a screen that opens on the band, spread on its
 * `RefreshControl`. iOS draws the spinner on the indigo pulled down above the band, so it is
 * white; Android draws it on a disc over the content, so the disc is the band's indigo.
 */
export function useTopBandRefreshColors() {
  const theme = useTheme()
  return useMemo(
    () => ({ tintColor: theme.colors.onBand, colors: [theme.colors.onBand], progressBackgroundColor: theme.colors.band }),
    [theme.colors.onBand, theme.colors.band],
  )
}

/** One pixel of the indigo under the band's top edge, so pulling down never opens a seam between them. */
const OVERLAP = 1

export type TopBandScreenProps = {
  band: TopBandController
  /**
   * Whether the screen is in front: only the focused screen sets the status bar. A tab stays
   * mounted behind the others, so an unfocused one gives the bar back.
   */
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
 *
 * The status bar is set with `expo-status-bar`, as everywhere in the apps. Its bars merge in the
 * order they mount, so the focused screen's, mounted after its layouts', wins over theirs: each
 * root layout sets the theme's own as the default, a stack layout may set its headers', and a
 * focused `TopBandScreen` sets its screen's.
 */
export function TopBandScreen({ band, focused, pageColor, children }: Readonly<TopBandScreenProps>) {
  const theme = useTheme()
  const page = pageColor ?? theme.colors.bg
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const statusBarHeight = insets.top
  const { scrollY, height } = band
  const [cleared, setCleared] = useState(false)

  // The status bar changes once per crossing, not with every frame.
  useAnimatedReaction(
    () => topBandPosition(scrollY.get(), height.get(), statusBarHeight).cleared,
    (now, before) => {
      if (now !== before) scheduleOnRN(setCleared, now)
    },
    [statusBarHeight],
  )
  const strip = useAnimatedStyle(() => ({ opacity: topBandPosition(scrollY.get(), height.get(), statusBarHeight).stripOpacity }))
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
      {/* White on the band, then the theme's own (dark in Light, white in Dark) once it has gone. */}
      {focused ? <StatusBar animated style={cleared ? "auto" : "light"} /> : null}
    </View>
  )
}

/**
 * What every top band does where it mounts. The band is the first thing in its scroll view, so a
 * band mounting means a fresh scroll view at its top (the shop page's other tab, a grid re-laid
 * for more columns): the scroll offset restarts at 0 there, not at the old view's. Returns the
 * band's `onLayout`, which measures it.
 */
function useRestartScrollAndMeasure({ scrollY, height }: TopBandController) {
  useEffect(() => {
    scrollY.set(0)
  }, [scrollY])
  return (event: LayoutChangeEvent) => height.set(event.nativeEvent.layout.height)
}

/** The space between the status bar and a top band's content when the screen doesn't say: the band's own top padding. */
function useBelowStatusBar(belowStatusBar: number | undefined) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  return insets.top + (belowStatusBar ?? theme.space[2])
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
 * Mounting it restarts the band's scroll offset at 0.
 */
export function TopBand({ band, belowStatusBar, style, children }: Readonly<TopBandProps>) {
  const onLayout = useRestartScrollAndMeasure(band)
  const paddingTop = useBelowStatusBar(belowStatusBar)
  return (
    <Band onLayout={onLayout} style={[style, { paddingTop }]}>
      {children}
    </Band>
  )
}

export type TopBandAreaProps = Omit<ViewProps, "onLayout"> & {
  band: TopBandController
  /** The space between the status bar and the area's content: its top padding (default `space[2]`, as for `TopBand`). */
  belowStatusBar?: number
}

/**
 * A top band drawn its own way (a shop's banner, a sign-in hero): measured like `TopBand` and
 * padded below the status bar, with its look left to the caller. Mounting it restarts the band's
 * scroll offset at 0.
 */
export function TopBandArea({ band, belowStatusBar, style, ...props }: Readonly<TopBandAreaProps>) {
  const onLayout = useRestartScrollAndMeasure(band)
  const paddingTop = useBelowStatusBar(belowStatusBar)
  return <View {...props} onLayout={onLayout} style={[style, { paddingTop }]} />
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  edge: { position: "absolute", left: 0, right: 0, pointerEvents: "none" },
})
