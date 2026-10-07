import { Text, useTheme } from '@oja/ui';
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
    <View style={{ gap: theme.space.xs }}>
      {label ? <Text variant="label">{label}</Text> : null}
      <TextInput
        accessibilityLabel={label ?? input.placeholder}
        placeholderTextColor={theme.colors.textSecondary}
        style={[
          styles.input,
          theme.type.body,
          {
            color: theme.colors.ink,
            borderColor: error ? theme.colors.danger : theme.colors.divider,
            borderRadius: theme.radius.md,
            minHeight: theme.touchTarget,
            paddingHorizontal: theme.space.md,
          },
          style,
        ]}
        {...input}
      />
      {error ? <Text tone="danger">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({ input: { borderWidth: 1.5 } });
