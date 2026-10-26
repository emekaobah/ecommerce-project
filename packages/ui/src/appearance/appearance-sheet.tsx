import * as Sentry from "@sentry/react-native"
import { useState } from "react"
import { View } from "react-native"
import { InlineNote } from "../components/inline-note"
import { RadioOption } from "../components/radio-option"
import { Sheet } from "../components/sheet"
import { Text } from "../components/text"
import { useTheme } from "../theme"
import { APPEARANCE_CHOICES, appearanceLabel, chooseAppearance, useAppearance } from "./appearance"
import type { AppearanceChoice } from "./appearance-store"

const hint: Partial<Record<AppearanceChoice, string>> = { system: "Follows your phone's setting" }

export type AppearanceSheetProps = {
  /** Closes the sheet once the choice is applied and kept. */
  onDone: () => void
}

/**
 * The Appearance sheet in both apps (#102): System, Light and Dark. Choosing switches the app at
 * once and closes the sheet; a choice the phone couldn't keep switches back and says so.
 */
export function AppearanceSheet({ onDone }: Readonly<AppearanceSheetProps>) {
  const theme = useTheme()
  const current = useAppearance()
  const [notKept, setNotKept] = useState(false)

  const choose = (choice: AppearanceChoice) => {
    setNotKept(false)
    chooseAppearance(choice).then(onDone, (error: unknown) => {
      Sentry.captureException(error, { tags: { action_error: "Couldn't keep the appearance" } })
      setNotKept(true)
    })
  }

  return (
    <Sheet title="Appearance" actions={notKept ? <InlineNote>{"Couldn't save that on this phone. Try again."}</InlineNote> : undefined}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Appearance" style={{ gap: theme.space[2] }}>
        {APPEARANCE_CHOICES.map((choice) => (
          <RadioOption key={choice} selected={current === choice} onPress={() => choose(choice)}>
            <Text weight="semibold">{appearanceLabel[choice]}</Text>
            {hint[choice] ? (
              <Text variant="meta" tone="muted">
                {hint[choice]}
              </Text>
            ) : null}
          </RadioOption>
        ))}
      </View>
    </Sheet>
  )
}
