import type { ReactNode } from "react"
import { View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useTheme } from "../theme"
import { Button } from "./button"
import { Text } from "./text"

export type SheetProps = {
  title: string
  /** One line under the title, e.g. the consequence of what the sheet asks. */
  message?: string
  children?: ReactNode
  /** The sheet's actions, stacked at its foot. */
  actions?: ReactNode
}

/**
 * The inside of a bottom sheet. Sheets open with the platform's own presentation (an Expo Router
 * route with `presentation: "formSheet"`), which brings the grabber, the scrim, the slide and
 * keeping focus inside; this lays out what they hold.
 */
export function Sheet({ title, message, children, actions }: Readonly<SheetProps>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View
      style={{
        backgroundColor: theme.colors.raised,
        paddingTop: theme.space[4],
        paddingHorizontal: theme.space[4],
        paddingBottom: Math.max(insets.bottom, theme.space[4]),
        gap: theme.space[3],
      }}
    >
      <Text variant="titlePushed">{title}</Text>
      {message ? (
        <Text tone="muted" style={{ lineHeight: theme.type.body.fontSize * 1.5 }}>
          {message}
        </Text>
      ) : null}
      {children}
      {actions ? <View style={{ gap: theme.space[2], marginTop: theme.space[1] }}>{actions}</View> : null}
    </View>
  )
}

export type ConfirmSheetProps = {
  /** The question: "Delete this address?" */
  title: string
  /** One line of consequence: "Home, 12 Adeniran Ogunsanya St is removed from your addresses." */
  message: string
  /** The action, in words: "Delete address". */
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  /** Red when it destroys something. */
  destructive?: boolean
  loading?: boolean
}

/**
 * A confirm step, used where an action can't be undone or moves money: the question, its
 * consequence, then the action and Cancel. Never a system alert.
 */
export function ConfirmSheet({ title, message, confirmLabel, onConfirm, onCancel, destructive, loading }: Readonly<ConfirmSheetProps>) {
  return (
    <Sheet
      title={title}
      message={message}
      actions={
        <>
          <Button label={confirmLabel} variant={destructive ? "danger" : "primary"} size="main" onPress={onConfirm} loading={loading} />
          <Button label="Cancel" variant="secondary" onPress={onCancel} disabled={loading} />
        </>
      }
    />
  )
}
