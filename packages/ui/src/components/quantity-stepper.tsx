import { stockLeftLabel } from "@oja/domain"
import { StyleSheet, View } from "react-native"
import { haptics } from "../haptics"
import { useTheme } from "../theme"
import { Icon } from "./icon"
import { PressableSurface } from "./pressable-surface"
import { Text } from "./text"

export type QuantityStepperProps = {
  value: number
  onChange: (quantity: number) => void
  /** How many can still be had (`@oja/domain` `availableQuantity`); null when stock isn't tracked. */
  available: number | null
  /** What is being counted, for screen readers: "Ofada Rice 5kg". */
  name: string
  min?: number
  /** "bar" in the product's sticky buy bar, "line" on a cart line. */
  size?: "bar" | "line"
  disabled?: boolean
}

/**
 * Minus, the quantity and plus. Plus stops at what's in stock, and below five left it says how
 * many ("Only 3 left") in ember. Each step is a selection haptic. Screen readers get one
 * adjustable control: swipe up or down to change it.
 */
export function QuantityStepper({ value, onChange, available, name, min = 1, size = "bar", disabled }: Readonly<QuantityStepperProps>) {
  const theme = useTheme()
  const canLess = !disabled && value > min
  const canMore = !disabled && (available === null || value < available)
  const left = stockLeftLabel(available)
  const bar = size === "bar"

  const step = (by: 1 | -1) => {
    haptics.selection()
    onChange(value + by)
  }

  return (
    <View style={[styles.column, { gap: theme.space[1] }]}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`Quantity of ${name}`}
        accessibilityValue={{ text: left ? `${value}, ${left}` : String(value) }}
        accessibilityState={{ disabled }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === "increment" && canMore) step(1)
          if (nativeEvent.actionName === "decrement" && canLess) step(-1)
        }}
        style={[
          styles.stepper,
          {
            height: bar ? theme.control.main : theme.hitArea,
            borderRadius: bar ? theme.radius.lg : theme.radius.pill,
            borderWidth: theme.line.input,
            borderColor: disabled ? theme.colors.line : theme.colors.control,
            backgroundColor: theme.colors.raised,
          },
        ]}
      >
        <StepButton icon="minus" enabled={canLess} onPress={() => step(-1)} />
        <Text variant="strong" tabular tone={disabled ? "muted" : "default"} style={[styles.value, { minWidth: theme.space[5] }]}>
          {value}
        </Text>
        <StepButton icon="plus" enabled={canMore} onPress={() => step(1)} />
      </View>
      {left ? (
        <Text variant="meta" tone="ember" weight="bold" importantForAccessibility="no" accessibilityElementsHidden>
          {left}
        </Text>
      ) : null}
    </View>
  )
}

function StepButton({ icon, enabled, onPress }: Readonly<{ icon: "minus" | "plus"; enabled: boolean; onPress: () => void }>) {
  const theme = useTheme()
  return (
    <PressableSurface
      disabled={!enabled}
      onPress={onPress}
      importantForAccessibility="no"
      style={[styles.half, { width: theme.block.stepperHalf }]}
    >
      <Icon name={icon} use="chip" color={enabled ? theme.colors.ink : theme.colors.muted} />
    </PressableSurface>
  )
}

const styles = StyleSheet.create({
  column: { alignItems: "flex-start" },
  stepper: { flexDirection: "row", alignItems: "stretch", overflow: "hidden" },
  half: { alignItems: "center", justifyContent: "center" },
  value: { textAlign: "center", alignSelf: "center" },
})
