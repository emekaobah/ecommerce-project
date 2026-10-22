import { line, MAX_FONT_SCALE, Text, useTheme } from '@oja/ui';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

export type FieldProps = TextInputProps & {
  /** Shown above the input; left out, the placeholder names the field. */
  label?: string;
  /** What to fix, shown under the input. */
  error?: string;
};

/** A text input at vendor sizes: large touch target, ink text, outlined, with an optional label and error. */
export function Field({ label, error, style, ...input }: FieldProps) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[1] }}>
      {label ? <Text variant="strong">{label}</Text> : null}
      <TextInput
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        accessibilityLabel={label ?? input.placeholder}
        placeholderTextColor={theme.colors.muted}
        style={[
          styles.input,
          theme.type.body,
          {
            color: theme.colors.ink,
            borderColor: error ? theme.colors.danger : theme.colors.control,
            borderRadius: theme.radius.md,
            minHeight: theme.hitArea,
            paddingHorizontal: theme.space[4],
          },
          style,
        ]}
        {...input}
      />
      {error ? <Text tone="danger">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({ input: { borderWidth: line.input } });
