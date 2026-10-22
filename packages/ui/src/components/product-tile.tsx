import { Image } from "expo-image"
import { StyleSheet, View } from "react-native"
import { useTheme } from "../theme"
import { lightTheme } from "../tokens"
import { Icon } from "./icon"
import { PressableSurface } from "./pressable-surface"
import { StatusChip } from "./status-chip"
import { Text } from "./text"

export type ProductTileProps = {
  name: string
  imageUrl?: string | null
  /** This shop's price, formatted. */
  price: string
  /** The price before a sale, shown crossed out. */
  wasPrice?: string | null
  /** The line under the name, e.g. the shop and its distance. */
  detail?: string | null
  /** The shop's deal on it, e.g. "10% off at this shop", on a sun badge. */
  deal?: string | null
  /** Greys the photo and shows "Sold out" in place of the add button. */
  soldOut?: boolean
  onPress: () => void
  /** Adds one to the cart; without it there is no add button. */
  onAdd?: () => void
  /** Saved to the wishlist; with `onToggleSave`, the photo carries a heart. */
  saved?: boolean
  onToggleSave?: () => void
}

/**
 * A product in a rail or grid: the photo on white in both themes, contained with a 10% margin
 * and no outline, then price, name and detail. Read as one item; the add and save buttons are
 * drawn small with a 44pt hit area and say which product they act on.
 */
export function ProductTile({
  name,
  imageUrl,
  price,
  wasPrice,
  detail,
  deal,
  soldOut,
  onPress,
  onAdd,
  saved,
  onToggleSave,
}: Readonly<ProductTileProps>) {
  const theme = useTheme()
  const button = theme.block.photoButton
  const slop = Math.max(0, (theme.hitArea - button) / 2)
  const spokenPrice = wasPrice ? `was ${wasPrice}, now ${price}` : price
  const spoken = [name, spokenPrice, deal, detail, soldOut ? "sold out" : null].filter(Boolean).join(", ")

  return (
    <PressableSurface accessibilityRole="button" accessibilityLabel={spoken} onPress={onPress} style={{ gap: theme.space[1] }}>
      <View style={[styles.photo, { backgroundColor: theme.colors.productTile, borderRadius: theme.radius.md }]}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} contentFit="contain" style={[styles.image, soldOut && styles.soldOut]} />
        ) : (
          <Icon name="bag" color={lightTheme.colors.muted} />
        )}
        {deal ? (
          <View
            style={[
              styles.topLeft,
              { top: theme.space[2], left: theme.space[2], backgroundColor: theme.colors.sun, borderRadius: theme.radius.pill },
              { paddingHorizontal: theme.space[2], paddingVertical: theme.space[1] },
            ]}
          >
            <Text variant="label" weight="extrabold" style={{ color: theme.colors.onSun }}>
              {deal}
            </Text>
          </View>
        ) : null}
        {onToggleSave ? (
          <PressableSurface
            accessibilityRole="button"
            accessibilityLabel={saved ? `Remove ${name} from saved` : `Save ${name}`}
            accessibilityState={{ selected: saved }}
            hitSlop={slop}
            onPress={onToggleSave}
            style={[
              styles.corner,
              theme.elevation.heart,
              { top: theme.space[2], right: theme.space[2], width: button, height: button, borderRadius: button / 2 },
              styles.heart,
            ]}
          >
            {/* The photo is white in both themes, so the heart keeps its light-theme colours. */}
            <Icon name="heart" use="chip" color={saved ? lightTheme.colors.dangerText : lightTheme.colors.ink} filled={saved} />
          </PressableSurface>
        ) : null}
        {soldOut ? (
          <View style={[styles.corner, { bottom: theme.space[2], right: theme.space[2] }]}>
            <StatusChip label="Sold out" tone="neutral" />
          </View>
        ) : null}
        {onAdd && !soldOut ? (
          <PressableSurface
            accessibilityRole="button"
            accessibilityLabel={`Add ${name} to cart`}
            hitSlop={slop}
            onPress={onAdd}
            style={[
              styles.corner,
              {
                bottom: theme.space[2],
                right: theme.space[2],
                width: button,
                height: button,
                borderRadius: theme.radius.sm,
                backgroundColor: theme.colors.primary,
              },
            ]}
          >
            <Icon name="plus" use="add" color={theme.colors.onPrimary} />
          </PressableSurface>
        ) : null}
      </View>
      <View style={[styles.price, { gap: theme.space[1] }]}>
        <Text variant="strong" tabular>
          {price}
        </Text>
        {wasPrice ? (
          <Text variant="meta" tone="muted" tabular style={styles.struck}>
            {wasPrice}
          </Text>
        ) : null}
      </View>
      <Text numberOfLines={2}>{name}</Text>
      {detail ? (
        <Text variant="meta" tone="muted">
          {detail}
        </Text>
      ) : null}
    </PressableSurface>
  )
}

const styles = StyleSheet.create({
  photo: { aspectRatio: 1, alignItems: "center", justifyContent: "center", overflow: "hidden", padding: "10%" },
  image: { width: "100%", height: "100%" },
  soldOut: { opacity: 0.55 },
  topLeft: { position: "absolute" },
  corner: { position: "absolute", alignItems: "center", justifyContent: "center" },
  heart: { backgroundColor: "rgba(255, 255, 255, 0.92)" },
  price: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap" },
  struck: { textDecorationLine: "line-through" },
})
