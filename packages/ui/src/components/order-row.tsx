import type { StatusChipView } from "@oja/domain"
import { Image } from "expo-image"
import type { ReactNode } from "react"
import { StyleSheet, View } from "react-native"
import { useTheme } from "../theme"
import { PressableSurface } from "./pressable-surface"
import { StatusChip } from "./status-chip"
import { Text } from "./text"

/** One shop's part of the order: its states as chips, named when the row covers several shops. */
export type OrderRowShop = { key: string; name?: string; chips: readonly StatusChipView[] }

export type OrderRowProps = {
  /** The shop's name, or "2 shops" for a checkout split across shops. */
  title: string
  /** "Today · 4 items · OJ-2410". */
  meta: string
  /** What was paid, formatted; shown at the right unless `trailing` takes its place. */
  price?: string
  shops: readonly OrderRowShop[]
  /** The first items' photos, so a buyer finds an order by what was in it. */
  thumbnails?: readonly string[]
  /** Replaces the price at the right, e.g. a delivered order's Order again (#86). */
  trailing?: ReactNode
  onPress: () => void
}

/** How many photos a row shows before "+N". */
const MAX_THUMBNAILS = 4

/**
 * One checkout in the Orders list ("Orders, full scroll"): a flat row with its title, meta and
 * price, the first items' photos, and each shop's state as chips; the list puts a `Divider`
 * between rows. The whole row opens the order.
 */
export function OrderRow({ title, meta, price, shops, thumbnails = [], trailing, onPress }: Readonly<OrderRowProps>) {
  const theme = useTheme()
  // The catalogue's 44px photo comes to a row control's height.
  const thumb = theme.control.row
  const shown = thumbnails.slice(0, MAX_THUMBNAILS)
  const more = thumbnails.length - shown.length
  const spoken = [
    title,
    meta,
    price,
    ...shops.flatMap((shop) => [shop.name, ...shop.chips.map((chip) => chip.label)]),
  ]
    .filter(Boolean)
    .join(", ")

  return (
    <PressableSurface
      accessibilityRole="button"
      accessibilityLabel={spoken}
      onPress={onPress}
      style={{ gap: theme.space[2], paddingTop: theme.space[5], paddingBottom: theme.space[6] }}
    >
      <View style={[styles.top, { gap: theme.space[3] }]}>
        <View style={styles.fill}>
          {/* A long shop name wraps to two lines, then truncates; the price beside it never shrinks. */}
          <Text variant="strong" numberOfLines={2}>
            {title}
          </Text>
          <Text variant="meta" tone="muted">
            {meta}
          </Text>
        </View>
        {trailing ??
          (price ? (
            <Text weight="extrabold" tabular>
              {price}
            </Text>
          ) : null)}
      </View>
      {shown.length ? (
        <View style={[styles.wrap, { gap: theme.space[2] }]}>
          {shown.map((uri, index) => (
            <View
              key={`${index}-${uri}`}
              style={{ width: thumb, height: thumb, borderRadius: theme.radius.md, overflow: "hidden", backgroundColor: theme.colors.productTile }}
            >
              <Image source={{ uri }} contentFit="contain" style={styles.fill} />
            </View>
          ))}
          {more > 0 ? (
            <View
              style={[
                styles.centre,
                { width: thumb, height: thumb, borderRadius: theme.radius.md, backgroundColor: theme.colors.tile },
              ]}
            >
              <Text variant="meta" weight="extrabold" tone="muted">{`+${more}`}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {/* The chips sit a little apart from the photos (the catalogue's .st margin). */}
      <View style={{ gap: theme.space[2], marginTop: theme.space[2] }}>
        {shops.map((shop) => (
          <View key={shop.key} style={{ gap: theme.space[1] }}>
            {shop.name ? (
              <Text variant="meta" tone="muted" numberOfLines={1}>
                {shop.name}
              </Text>
            ) : null}
            <View style={[styles.wrap, { gap: theme.space[2] }]}>
              {shop.chips.map((chip) => (
                <StatusChip key={chip.label} label={chip.label} tone={chip.tone} icon={chip.icon} />
              ))}
            </View>
          </View>
        ))}
      </View>
    </PressableSurface>
  )
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  fill: { flex: 1 },
  wrap: { flexDirection: "row", flexWrap: "wrap" },
  centre: { alignItems: "center", justifyContent: "center" },
})
