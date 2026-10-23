import { focusRing, Icon, MAX_FONT_SCALE, PressableSurface, useTheme } from '@oja/ui';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

// TODO(#77): use @oja/ui SearchField. A private copy of its editable form (same props and
// look) until #77 merges into feat/57-adire-screens; delete this file then.

type SearchFieldProps = {
  value: string;
  onChangeText: (text: string) => void;
  /** Also what screen readers call the field. */
  placeholder: string;
};

/** The search field: a search icon, what's typed and a clear button once there is something to clear. */
export function SearchField({ value, onChangeText, placeholder }: Readonly<SearchFieldProps>) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={[
        styles.field,
        {
          minHeight: theme.control.row,
          gap: theme.space[2],
          paddingLeft: theme.space[4],
          paddingRight: value ? 0 : theme.space[4],
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.raised,
        },
        focused ? { borderWidth: theme.line.input, borderColor: theme.colors.accent, boxShadow: focusRing(theme) } : null,
      ]}>
      <Icon name="search" use="step" color={theme.colors.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
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
      {value ? (
        <PressableSurface
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChangeText('')}
          style={[styles.clear, { width: theme.hitArea, minHeight: theme.hitArea }]}>
          <Icon name="x" use="step" color={theme.colors.muted} />
        </PressableSurface>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center' },
  fill: { flex: 1 },
  input: { paddingVertical: 0 },
  clear: { alignItems: 'center', justifyContent: 'center' },
});
