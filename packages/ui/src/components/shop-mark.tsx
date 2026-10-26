import { shopInitials } from "@oja/domain"
import { Image } from "expo-image"
import { useState } from "react"
import { StyleSheet, View } from "react-native"
import { FONT_FACES } from "../fonts"
import { useTheme } from "../theme"
import type { shopMark } from "../tokens"
import { AdirePattern } from "./adire-pattern"
import { Text } from "./text"

export type ShopMarkProps = {
  name: string
  /** The logo the shop uploaded in the vendor panel; without one, or if it won't load, the monogram. */
  logoUrl?: string | null
  /** sm in rows, md heading a shop's group, lg on the shop page (with an edge against the banner). */
  size?: keyof typeof shopMark
}

/**
 * A shop's logo, or its initials on the indigo pattern, so every shop looks deliberate. Hidden
 * from screen readers: the shop's name is always written beside it.
 */
export function ShopMark({ name, logoUrl, size = "sm" }: Readonly<ShopMarkProps>) {
  const theme = useTheme()
  const [failed, setFailed] = useState<string | null>(null)
  const mark = theme.shopMark[size]
  const edge = "border" in mark ? mark.border : 0
  const logo = logoUrl && failed !== logoUrl ? logoUrl : null

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.mark,
        {
          width: mark.size,
          height: mark.size,
          borderRadius: mark.radius,
          borderWidth: edge || (logo ? theme.line.divider : 0),
          borderColor: edge ? theme.colors.bg : theme.colors.line,
          backgroundColor: logo ? theme.colors.paper : theme.colors.band,
        },
      ]}
    >
      {logo ? (
        <Image source={{ uri: logo }} contentFit="cover" style={StyleSheet.absoluteFill} onError={() => setFailed(logo)} />
      ) : (
        <>
          <AdirePattern />
          {/* Sized by its box, so it doesn't grow with the text setting. */}
          <Text
            maxFontSizeMultiplier={1}
            style={{
              fontFamily: FONT_FACES.display.extrabold,
              fontSize: mark.fontSize,
              lineHeight: mark.fontSize * 1.1,
              color: theme.colors.onBand,
            }}
          >
            {shopInitials(name)}
          </Text>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  mark: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
})
