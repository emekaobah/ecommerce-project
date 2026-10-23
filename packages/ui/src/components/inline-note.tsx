import { Children, isValidElement, useEffect, type ReactNode } from "react"
import { AccessibilityInfo, Platform, StyleSheet, View } from "react-native"
import { useTheme } from "../theme"
import { Icon } from "./icon"
import { Text } from "./text"

export type InlineNoteProps = {
  /** The problem in plain words; a lead sentence can be a bold `<Text>` nested inside. */
  children: ReactNode
  /**
   * Ember for a problem, the tone of what waits on the buyer; info for a plain fact staff should
   * know before acting (Mist, muted words, the info icon in accent).
   */
  tone?: "ember" | "info"
}

/**
 * An inline problem (a payment not completed, an address that didn't save, a price that
 * changed, an item the shop didn't have): an ember note set just above the button it affects,
 * read out by screen readers as it appears (State rules). The info tone tells what a button
 * will do (the refund marking items short makes) and is read in place, not announced.
 */
export function InlineNote({ children, tone = "ember" }: Readonly<InlineNoteProps>) {
  const theme = useTheme()
  const problem = tone === "ember"
  const { foreground, background } = problem
    ? theme.status.attention
    : { foreground: theme.colors.muted, background: theme.colors.tile }
  const spoken = spokenText(children)

  // Android reads the live region; iOS has none, so the note is announced as it appears.
  useEffect(() => {
    if (problem && Platform.OS === "ios" && spoken) AccessibilityInfo.announceForAccessibility(spoken)
  }, [problem, spoken])

  return (
    <View
      accessible
      accessibilityLabel={spoken}
      accessibilityRole={problem ? "alert" : "text"}
      accessibilityLiveRegion={problem ? "polite" : "none"}
      style={[
        styles.note,
        { gap: theme.space[2], padding: theme.space[2], borderRadius: theme.radius.md, backgroundColor: background },
      ]}
    >
      <Icon name="info" use="chip" color={problem ? foreground : theme.colors.accent} />
      <Text variant="meta" style={[styles.text, { color: foreground }]}>
        {children}
      </Text>
    </View>
  )
}

/** The note's words, from its strings and the strings of what is nested in it. */
function spokenText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child)
      if (isValidElement<{ children?: ReactNode }>(child)) return spokenText(child.props.children)
      return ""
    })
    .join("")
}

const styles = StyleSheet.create({
  note: { flexDirection: "row", alignItems: "flex-start" },
  text: { flex: 1 },
})
