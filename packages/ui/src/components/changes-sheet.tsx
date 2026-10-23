import { Image } from "expo-image"
import { StyleSheet, View } from "react-native"
import { useTheme } from "../theme"
import { Button } from "./button"
import { Sheet } from "./sheet"
import { Text } from "./text"

/** One thing that changed: what it was about ("Ijebu Garri 4kg"), and what happened to it. */
export type ChangesSheetChange = { key: string; label: string; detail?: string | null; imageUrl?: string | null }

export type ChangesSheetProps = {
  /** "Some items changed" */
  title: string
  /** What is safe, then what follows: "Nothing has been charged. Since you added them:" */
  message: string
  changes: readonly ChangesSheetChange[]
  /** "New total" */
  totalLabel: string
  /** The new total, formatted: it also sits on the confirm button. */
  total: string
  /** "Update and pay" */
  confirmLabel: string
  onConfirm: () => void
  /** "Back to cart" */
  backLabel: string
  onBack: () => void
  loading?: boolean
}

/**
 * Before money moves again: each change since the buyer last saw the total, the new total, then
 * paying it or going back. Content for a native `formSheet` route, like `Sheet`.
 */
export function ChangesSheet({
  title,
  message,
  changes,
  totalLabel,
  total,
  confirmLabel,
  onConfirm,
  backLabel,
  onBack,
  loading,
}: Readonly<ChangesSheetProps>) {
  const theme = useTheme()
  // The catalogue's 48px line photo comes to a standard control's height.
  const photo = theme.control.md
  return (
    <Sheet
      title={title}
      message={message}
      actions={
        <>
          <Button label={confirmLabel} detail={total} size="main" onPress={onConfirm} loading={loading} />
          <Button label={backLabel} variant="secondary" onPress={onBack} disabled={loading} />
        </>
      }
    >
      {changes.map((change) => (
        <View key={change.key} accessible style={[styles.row, { gap: theme.space[2] }]}>
          {change.imageUrl === undefined ? null : (
            <Image
              source={change.imageUrl}
              contentFit="contain"
              accessibilityIgnoresInvertColors
              style={{ width: photo, height: photo, borderRadius: theme.radius.md, backgroundColor: theme.colors.productTile }}
            />
          )}
          <View style={[styles.fill, { gap: theme.space[1] }]}>
            <Text weight="bold">{change.label}</Text>
            {change.detail ? (
              <Text variant="meta" tone="muted">
                {change.detail}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
      <View
        accessible
        style={[
          styles.total,
          { paddingTop: theme.space[2], borderTopWidth: theme.line.divider, borderTopColor: theme.colors.line },
        ]}
      >
        <Text variant="strong">{totalLabel}</Text>
        <Text variant="heading" tabular>
          {total}
        </Text>
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  fill: { flex: 1 },
  total: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
})
