import type { ReactNode } from "react"
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native"
import { useTheme } from "../theme"
import { AdirePattern } from "./adire-pattern"

export type BandProps = {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  onLayout?: (event: LayoutChangeEvent) => void
}

/**
 * The brand band at the top of Home, order and vendor screens: indigo in both themes, the
 * pattern fading in from the right behind the text, straight edges, and nothing overlapping it.
 * Its text takes the `onBand` tone.
 */
export function Band({ children, style, onLayout }: Readonly<BandProps>) {
  const theme = useTheme()
  return (
    <View
      onLayout={onLayout}
      style={[
        styles.band,
        {
          backgroundColor: theme.colors.band,
          paddingTop: theme.space[2],
          paddingHorizontal: theme.space[4],
          paddingBottom: theme.space[5],
          gap: theme.space[3],
        },
        style,
      ]}
    >
      <AdirePattern fade="right" />
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  band: { overflow: "hidden" },
})
