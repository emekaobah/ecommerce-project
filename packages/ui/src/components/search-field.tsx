import { useState } from "react"
import { StyleSheet, TextInput, View, type TextInputProps } from "react-native"
import { useTheme } from "../theme"
import { focusRing, MAX_FONT_SCALE } from "../tokens"
import { Icon } from "./icon"
import { PressableSurface } from "./pressable-surface"
import { Text } from "./text"

export type SearchFieldProps = {
  value: string
  onChangeText: (text: string) => void
  /** Also what screen readers call the field: "Search products". */
  placeholder: string
  onSubmitEditing?: TextInputProps["onSubmitEditing"]
  autoFocus?: boolean
  /** With `onPress`, false makes it a button that opens search elsewhere (Home's band). */
  editable?: boolean
  onPress?: () => void
}

/**
 * The search field: a search icon, what's typed and a clear button once there is something to
 * clear, outlined like any input, an accent outline and ring when focused. As a button on the
 * band it has no outline.
 */
export function SearchField({ value, onChangeText, placeholder, onSubmitEditing, autoFocus, editable = true, onPress }: Readonly<SearchFieldProps>) {
  const theme = useTheme()
  const [focused, setFocused] = useState(false)
  const field = [
    styles.field,
    {
      minHeight: theme.control.row,
      gap: theme.space[2],
      paddingLeft: theme.space[4],
      paddingRight: value && editable ? 0 : theme.space[4],
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.raised,
    },
  ]

  if (!editable && onPress) {
    return (
      <PressableSurface accessibilityRole="search" accessibilityLabel={placeholder} accessibilityHint="Opens search" onPress={onPress} style={field}>
        <Icon name="search" use="step" color={theme.colors.muted} />
        <Text weight="semibold" tone="muted" numberOfLines={1} style={styles.fill}>
          {value || placeholder}
        </Text>
      </PressableSurface>
    )
  }

  return (
    <View
      style={[
        field,
        { borderWidth: theme.line.input, borderColor: focused ? theme.colors.accent : theme.colors.control },
        focused ? { boxShadow: focusRing(theme) } : null,
      ]}
    >
      <Icon name="search" use="step" color={theme.colors.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        autoFocus={autoFocus}
        editable={editable}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.muted}
        accessibilityLabel={placeholder}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        returnKeyType="search"
        autoCorrect={false}
        clearButtonMode="never"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[theme.type.body, styles.fill, styles.input, { color: theme.colors.ink }]}
      />
      {value && editable ? (
        <PressableSurface
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChangeText("")}
          style={[styles.clear, { width: theme.hitArea, minHeight: theme.hitArea }]}
        >
          <Icon name="x" use="step" color={theme.colors.muted} />
        </PressableSurface>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  field: { flexDirection: "row", alignItems: "center" },
  fill: { flex: 1 },
  input: { paddingVertical: 0 },
  clear: { alignItems: "center", justifyContent: "center" },
})
