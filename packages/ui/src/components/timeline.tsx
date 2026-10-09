import { StyleSheet, View } from "react-native"
import { useTheme } from "../theme"
import { Text } from "./text"

/** One step of a timeline: done, where things are now, or still to come; `at` when it was reached. */
export type TimelineStepProps = { label: string; status: "done" | "current" | "upcoming"; at: string | null }

export type TimelineProps = {
  steps: readonly TimelineStepProps[]
  /** How a step's time reads (it arrives as ISO 8601). */
  formatTime?: (at: string) => string
}

const SYMBOLS = { done: "✓", current: "●", upcoming: "○" } as const
const SYMBOL_TONES = { done: "default", current: "accent", upcoming: "secondary" } as const
const SPOKEN = { done: "done", current: "now", upcoming: "to come" } as const

const defaultTime = (at: string) => new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

/**
 * Steps in order, each with a symbol and its label (never colour alone): ticked when done, a
 * dot in the progress colour where things are now, an open circle for what is to come.
 */
export function Timeline({ steps, formatTime = defaultTime }: TimelineProps) {
  const theme = useTheme()
  return (
    <View style={{ gap: theme.space.sm }}>
      {steps.map((step) => {
        const time = step.at && step.status !== "upcoming" ? formatTime(step.at) : null
        const upcoming = step.status === "upcoming"
        return (
          <View
            key={step.label}
            accessible
            accessibilityLabel={[step.label, SPOKEN[step.status], time].filter(Boolean).join(", ")}
            style={[styles.row, { gap: theme.space.sm }]}
          >
            <Text importantForAccessibility="no" style={styles.symbol} tone={SYMBOL_TONES[step.status]}>
              {SYMBOLS[step.status]}
            </Text>
            <View style={styles.fill}>
              <Text variant={step.status === "current" ? "label" : "body"} tone={upcoming ? "secondary" : "default"}>
                {step.label}
              </Text>
              {time ? (
                <Text variant="caption" tone="secondary">
                  {time}
                </Text>
              ) : null}
            </View>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start" },
  symbol: { width: 20, textAlign: "center" },
  fill: { flex: 1 },
})
