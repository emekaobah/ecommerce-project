import type { ReactNode } from "react"
import { ActivityIndicator, StyleSheet, View } from "react-native"
import { useTheme } from "../theme"
import { Button } from "./button"
import { Text } from "./text"

// Every data screen designs four states: loading, error, empty and content (ADR 0001).

function Centered({ children }: Readonly<{ children: ReactNode }>) {
  const theme = useTheme()
  return <View style={[styles.centered, { padding: theme.space[4], gap: theme.space[3] }]}>{children}</View>
}

export function LoadingState({ label = "Loading…" }: Readonly<{ label?: string }>) {
  const theme = useTheme()
  return (
    <Centered>
      <ActivityIndicator size="large" color={theme.colors.ink} accessibilityLabel={label} />
    </Centered>
  )
}

export type ErrorStateProps = {
  title?: string
  message?: string
  onRetry?: () => void
}

export function ErrorState({ title = "Something went wrong", message, onRetry }: Readonly<ErrorStateProps>) {
  return (
    <Centered>
      <Text variant="heading" style={styles.text}>
        {title}
      </Text>
      {message ? (
        <Text tone="muted" style={styles.text}>
          {message}
        </Text>
      ) : null}
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} style={styles.action} /> : null}
    </Centered>
  )
}

export type EmptyStateProps = {
  title: string
  message?: string
  action?: { label: string; onPress: () => void }
}

export function EmptyState({ title, message, action }: Readonly<EmptyStateProps>) {
  return (
    <Centered>
      <Text variant="heading" style={styles.text}>
        {title}
      </Text>
      {message ? (
        <Text tone="muted" style={styles.text}>
          {message}
        </Text>
      ) : null}
      {action ? <Button label={action.label} onPress={action.onPress} style={styles.action} /> : null}
    </Centered>
  )
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  text: { textAlign: "center" },
  action: { alignSelf: "stretch" },
})
