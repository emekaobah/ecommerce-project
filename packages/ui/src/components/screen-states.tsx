import * as Sentry from "@sentry/react-native"
import { useEffect, type ReactNode } from "react"
import { ActivityIndicator, StyleSheet, View } from "react-native"
import { useTheme } from "../theme"
import { AdirePattern } from "./adire-pattern"
import { Button } from "./button"
import { Icon, type IconName } from "./icon"
import { Text } from "./text"

// Every data screen designs four states: loading, error, empty and content (ADR 0001). Loading
// is a skeleton in the content's shape; LoadingState's spinner is only for waits with no layout.

/** An action under an empty or error state. */
export type StateAction = { label: string; onPress: () => void }

type StateLayoutProps = { emblem: ReactNode; title: string; body: string; children?: ReactNode }

function StateLayout({ emblem, title, body, children }: Readonly<StateLayoutProps>) {
  const theme = useTheme()
  return (
    <View style={[styles.layout, { paddingTop: theme.space[12], paddingHorizontal: theme.space[6], gap: theme.space[3] }]}>
      {emblem}
      <Text variant="titleNamed" style={styles.centred}>
        {title}
      </Text>
      <Text tone="muted" style={[styles.centred, { lineHeight: theme.type.body.fontSize * 1.5 }]}>
        {body}
      </Text>
      {children ? <View style={[styles.actions, { gap: theme.space[2], marginTop: theme.space[2] }]}>{children}</View> : null}
    </View>
  )
}

/** A spinner, for waits with no layout to preview: confirming a payment, opening Paystack. */
export function LoadingState({ label = "Loading…" }: Readonly<{ label?: string }>) {
  const theme = useTheme()
  return (
    <View style={[styles.centre, { padding: theme.space[4] }]}>
      <ActivityIndicator size="large" color={theme.colors.primary} accessibilityLabel={label} />
    </View>
  )
}

export type ErrorStateProps = {
  /** What happened, in plain words: "Couldn't load your orders". */
  title: string
  /** What to do and what is safe: "Check your connection and try again. Anything in your cart is saved." */
  body: string
  /** The technical error: reported to Sentry, never shown. */
  error?: unknown
  /** The one retry. */
  onRetry?: () => void
  /** The retry's words when it isn't a plain retry: "Check again". */
  retryLabel?: string
  /** A way back, under the retry: "Back to checkout". */
  secondaryAction?: StateAction
  icon?: IconName
}

/**
 * A full-screen error: the quiet Mist emblem (so it never looks like an empty state), what
 * happened, what is safe, and one retry. The raw message goes to Sentry, not the screen.
 */
export function ErrorState({
  title,
  body,
  error,
  onRetry,
  retryLabel = "Try again",
  secondaryAction,
  icon = "cloud-off",
}: Readonly<ErrorStateProps>) {
  const theme = useTheme()

  useEffect(() => {
    if (error) Sentry.captureException(error, { tags: { screen_error: title } })
  }, [error, title])

  const size = theme.block.quietEmblem
  return (
    <StateLayout
      title={title}
      body={body}
      emblem={
        <View style={[styles.emblem, { width: size, height: size, borderRadius: theme.radius.sheet, backgroundColor: theme.colors.tile }]}>
          <Icon name={icon} use="quietEmblem" color={theme.colors.accent} />
        </View>
      }
    >
      {onRetry ? <Button label={retryLabel} icon="refresh" onPress={onRetry} /> : null}
      {secondaryAction ? <Button label={secondaryAction.label} variant="secondary" onPress={secondaryAction.onPress} /> : null}
    </StateLayout>
  )
}

export type EmptyStateProps = {
  /** What isn't here yet: "No orders yet". */
  title: string
  /** What will appear here, and how to get there. */
  body: string
  icon?: IconName
  /** At most two ways forward. */
  action?: StateAction
  secondaryAction?: StateAction
}

/** Nothing to show yet: the indigo pattern emblem, what will appear here, and at most two ways forward. */
export function EmptyState({ title, body, icon = "box", action, secondaryAction }: Readonly<EmptyStateProps>) {
  const theme = useTheme()
  const size = theme.block.emblem
  return (
    <StateLayout
      title={title}
      body={body}
      emblem={
        <View style={[styles.emblem, { width: size, height: size, borderRadius: theme.radius.sheet, backgroundColor: theme.colors.band }]}>
          <AdirePattern opacity={0.55} />
          <Icon name={icon} use="emblem" color={theme.colors.onBand} />
        </View>
      }
    >
      {action ? <Button label={action.label} onPress={action.onPress} /> : null}
      {secondaryAction ? <Button label={secondaryAction.label} variant="secondary" onPress={secondaryAction.onPress} /> : null}
    </StateLayout>
  )
}

const styles = StyleSheet.create({
  layout: { flex: 1, alignItems: "center" },
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  centred: { textAlign: "center" },
  actions: { alignSelf: "stretch" },
  emblem: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
})
