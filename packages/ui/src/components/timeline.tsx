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

const SPOKEN = { done: "done", current: "now", upcoming: "to come" } as const

const defaultTime = (at: string) => new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

/**
 * Steps in order down a line, each with its label (never colour alone): a filled leaf dot when
 * done, a leaf ring where things are now, a grey dot for what is to come. The line is leaf as far
 * as things have got.
 */
export function Timeline({ steps, formatTime = defaultTime }: Readonly<TimelineProps>) {
  const theme = useTheme()
  const dot = theme.icon.size.default
  return (
    <View>
      {steps.map((step, index) => {
        const time = step.at && step.status !== "upcoming" ? formatTime(step.at) : null
        const last = index === steps.length - 1
        return (
          <View
            key={step.label}
            accessible
            accessibilityLabel={[step.label, SPOKEN[step.status], time].filter(Boolean).join(", ")}
            style={[styles.row, { gap: theme.space[3] }]}
          >
            <View style={[styles.rail, { width: dot }]}>
              <View
                style={[
                  styles.dot,
                  { width: dot, height: dot, borderRadius: dot / 2 },
                  step.status === "done" && { backgroundColor: theme.colors.leaf },
                  step.status === "current" && {
                    backgroundColor: theme.colors.bg,
                    borderWidth: theme.line.ring,
                    borderColor: theme.colors.leaf,
                  },
                  step.status === "upcoming" && { backgroundColor: theme.colors.line },
                ]}
              >
                {step.status === "done" ? (
                  <View style={{ width: dot / 3, height: dot / 3, borderRadius: dot / 6, backgroundColor: theme.colors.onPrimary }} />
                ) : null}
              </View>
              {last ? null : (
                <View
                  style={[
                    styles.connector,
                    {
                      width: theme.line.input,
                      backgroundColor: step.status === "done" ? theme.colors.leaf : theme.colors.line,
                    },
                  ]}
                />
              )}
            </View>
            <View style={[styles.fill, { gap: theme.space[1], paddingBottom: last ? 0 : theme.space[6] }]}>
              <Text weight="bold" tone={step.status === "upcoming" ? "muted" : "default"}>
                {step.label}
              </Text>
              {time ? (
                <Text variant="meta" tone="muted">
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
  row: { flexDirection: "row", alignItems: "stretch" },
  rail: { alignItems: "center" },
  dot: { alignItems: "center", justifyContent: "center" },
  connector: { flex: 1 },
  fill: { flex: 1 },
})
