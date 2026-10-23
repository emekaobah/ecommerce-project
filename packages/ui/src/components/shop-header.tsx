import { Image } from "expo-image"
import { useState, type ReactNode } from "react"
import { StyleSheet, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useTheme } from "../theme"
import { AdirePattern } from "./adire-pattern"
import { ShopMark } from "./shop-mark"
import { Text } from "./text"

export type ShopHeaderProps = {
  name: string
  logoUrl?: string | null
  /** The banner the shop uploaded; without one, or if it won't load, the indigo pattern. */
  bannerUrl?: string | null
  /** Round buttons over the banner's top: back on the left, share on the right. */
  actions?: ReactNode
  /** The line under the name: open state, rating, distance. */
  children?: ReactNode
  /** The shop's own description. */
  description?: string | null
}

/**
 * The top of a shop's page: the indigo band behind the status bar, its banner below it, its mark
 * overlapping the banner's foot, then its name, a line of facts and its description.
 */
export function ShopHeader({ name, logoUrl, bannerUrl, actions, children, description }: Readonly<ShopHeaderProps>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [failed, setFailed] = useState<string | null>(null)
  const banner = bannerUrl && failed !== bannerUrl ? bannerUrl : null
  const overlap = theme.shopMark.lg.size / 2

  return (
    <View>
      {/* A solid band behind the status bar; the banner starts below it. */}
      <View style={{ height: insets.top, backgroundColor: theme.colors.band }} />
      <View style={[styles.cover, { height: theme.block.banner, backgroundColor: theme.colors.band }]}>
        {banner ? (
          <Image
            source={{ uri: banner }}
            contentFit="cover"
            style={StyleSheet.absoluteFill}
            accessibilityIgnoresInvertColors
            onError={() => setFailed(banner)}
          />
        ) : (
          <AdirePattern />
        )}
        {actions ? (
          <View style={[styles.actions, { top: theme.space[1], left: theme.space[3], right: theme.space[3] }]}>{actions}</View>
        ) : null}
      </View>
      <View style={{ marginTop: -overlap, paddingHorizontal: theme.space[4], paddingBottom: theme.space[2], gap: theme.space[2] }}>
        <ShopMark name={name} logoUrl={logoUrl} size="lg" />
        <Text variant="titleNamed">{name}</Text>
        {children ? <View style={[styles.facts, { gap: theme.space[2] }]}>{children}</View> : null}
        {description ? <Text style={{ lineHeight: theme.type.body.fontSize * 1.5 }}>{description}</Text> : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  cover: { overflow: "hidden" },
  actions: { position: "absolute", flexDirection: "row", justifyContent: "space-between" },
  facts: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
})
