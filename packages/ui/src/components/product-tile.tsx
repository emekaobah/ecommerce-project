import { Image } from "expo-image"
import { StyleSheet, View } from "react-native"
import { useTheme } from "../theme"
import { lightTheme } from "../tokens"
import { Icon } from "./icon"
import { PhotoTile } from "./photo-tile"
import { PressableSurface } from "./pressable-surface"
import { DealBadge } from "./deal-badge"
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
  /** The shop isn't taking orders (a break or a closure): greyed, "Closed", and no add button. */
  closed?: boolean
  onPress: () => void
  /** Adds one to the cart; without it there is no add button. */
  onAdd?: () => void
  /** Saved to the wishlist; with `onToggleSave`, the photo carries a heart. */
  saved?: boolean
  onToggleSave?: () => void
}

/** What VoiceOver reads for the tile: "Rice, was ₦5,000, now ₦4,500, 10% off at this shop, sold out". */
function spokenTile({ name, price, wasPrice, deal, detail, soldOut, closed }: Readonly<ProductTileProps>): string {
  const spokenPrice = wasPrice ? `was ${wasPrice}, now ${price}` : price
  const state = soldOut ? "sold out" : closed && "shop closed"
  return [name, spokenPrice, deal, detail, state].filter(Boolean).join(", ")
}

/** The photo's top-left corner: "Sold out" or "Closed" when it can't be bought, else the deal. */
function CornerBadge({ soldOut, closed, deal }: Readonly<Pick<ProductTileProps, "soldOut" | "closed" | "deal">>) {
  const theme = useTheme()
  const inset = { top: theme.space[2], left: theme.space[2] }
  if (soldOut) {
    return (
      <View style={[styles.corner, inset]}>
        <StatusChip label="Sold out" tone="neutral" />
      </View>
    )
  }
  if (closed) {
    return (
      <View style={[styles.corner, inset]}>
        <StatusChip label="Closed" tone="neutral" icon="clock" />
      </View>
    )
  }
  if (!deal) return null
  return (
    <View style={[styles.corner, inset, { right: theme.space[2] }]}>
      <DealBadge label={deal} />
    </View>
  )
}

/**
 * A product in a rail or grid: the photo on its tile (`PhotoTile`: white, veiled in dark), contained
 * with a 10% margin and no outline, then price, name and detail. Read as one item; the add and save buttons are
 * drawn small with a 44pt hit area and say which product they act on.
 */
export function ProductTile(props: Readonly<ProductTileProps>) {
  const { name, imageUrl, price, wasPrice, detail, deal, soldOut, closed, onPress, onAdd, saved, onToggleSave } = props
  const theme = useTheme()
  const button = theme.block.photoButton
  const slop = Math.max(0, (theme.hitArea - button) / 2)
  const unavailable = soldOut || closed

  return (
    <PressableSurface accessibilityRole="button" accessibilityLabel={spokenTile(props)} onPress={onPress} style={{ gap: theme.space[1] }}>
      <PhotoTile
        style={[styles.photo, { borderRadius: theme.radius.md }]}
        overlay={
          <>
            <CornerBadge soldOut={soldOut} closed={closed} deal={deal} />
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
                {/* The heart sits on a white disc in both themes, so it keeps its light-theme colours. */}
                <Icon name="heart" use="chip" color={saved ? lightTheme.colors.dangerText : lightTheme.colors.ink} filled={saved} />
              </PressableSurface>
            ) : null}
            {onAdd && !unavailable ? (
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
          </>
        }
      >
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} contentFit="contain" style={[styles.image, unavailable && styles.unavailable]} />
        ) : (
          <Icon name="bag" color={lightTheme.colors.muted} />
        )}
      </PhotoTile>
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
      <Text variant="meta" weight="semibold" numberOfLines={2} style={unavailable ? { color: theme.colors.muted } : null}>
        {name}
      </Text>
      {detail ? (
        <Text variant="meta" tone="muted">
          {detail}
        </Text>
      ) : null}
    </PressableSurface>
  )
}

const styles = StyleSheet.create({
  photo: { aspectRatio: 1, alignItems: "center", justifyContent: "center", padding: "10%" },
  image: { width: "100%", height: "100%" },
  unavailable: { opacity: 0.55 },
  corner: { position: "absolute", alignItems: "center", justifyContent: "center" },
  heart: { backgroundColor: "rgba(255, 255, 255, 0.92)" },
  price: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap" },
  struck: { textDecorationLine: "line-through" },
})
