import { Host, Picker } from '@expo/ui';
import type { AddressConfig, AddressField, AddressFieldKey, AddressFormErrors, AddressFormValues } from '@oja/domain';
import { line, MAX_FONT_SCALE, Text, useTheme } from '@oja/ui';
import { useRef, type ComponentRef, type Ref } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

/** Keyboard and autofill hints per field, so the phone's own suggestions fill the form. */
const INPUT_HINTS: Partial<Record<AddressFieldKey, TextInputProps>> = {
  first_name: { autoComplete: 'given-name', textContentType: 'givenName' },
  last_name: { autoComplete: 'family-name', textContentType: 'familyName' },
  address_1: { autoComplete: 'address-line1', textContentType: 'streetAddressLine1' },
  address_2: { autoComplete: 'address-line2', textContentType: 'streetAddressLine2' },
  phone: { autoComplete: 'tel', textContentType: 'telephoneNumber', keyboardType: 'phone-pad' },
};

/**
 * The delivery address form for a country, field by field from its config (ADR 0002). Address
 * search and current location fill it, and every field stays editable (`address-entry`).
 */
export function AddressForm({
  config,
  values,
  errors,
  onChange,
  onSubmit,
}: Readonly<{
  config: AddressConfig;
  values: AddressFormValues;
  errors: AddressFormErrors;
  onChange: (key: AddressFieldKey, value: string) => void;
  /** Given for a form of text fields only: return moves to the next field, and submits from the last. */
  onSubmit?: () => void;
}>) {
  const theme = useTheme();
  const inputs = useRef<(ComponentRef<typeof TextInput> | null)[]>([]);
  const last = config.fields.length - 1;
  const submitting = (index: number): TextInputProps =>
    onSubmit
      ? {
          returnKeyType: index === last ? 'done' : 'next',
          submitBehavior: index === last ? 'blurAndSubmit' : 'submit',
          onSubmitEditing: index === last ? onSubmit : () => inputs.current[index + 1]?.focus(),
        }
      : {};
  return (
    <View style={{ gap: theme.space[4] }}>
      {config.fields.map((field, index) => (
        <Field
          key={field.key}
          ref={(input) => {
            inputs.current[index] = input;
          }}
          field={field}
          value={values[field.key] ?? ''}
          error={errors[field.key]}
          placeholder={field.key === 'phone' ? config.phone.placeholder : field.placeholder}
          onChange={(value) => onChange(field.key, value)}
          submit={submitting(index)}
        />
      ))}
    </View>
  );
}

function Field({
  ref,
  field,
  value,
  error,
  placeholder,
  onChange,
  submit,
}: Readonly<{
  ref: Ref<ComponentRef<typeof TextInput>>;
  field: AddressField;
  value: string;
  error: string | undefined;
  placeholder: string | undefined;
  onChange: (value: string) => void;
  /** What return does: move on, or submit the form. */
  submit: TextInputProps;
}>) {
  const theme = useTheme();
  const label = field.required ? field.label : `${field.label} (optional)`;
  const box = {
    minHeight: theme.hitArea,
    borderRadius: theme.radius.md,
    borderColor: error ? theme.colors.danger : theme.colors.control,
    paddingHorizontal: theme.space[4],
  };
  return (
    <View style={{ gap: theme.space[1] }}>
      <Text variant="strong">{label}</Text>
      {field.options ? (
        <View style={[styles.box, box]}>
          <Host matchContents style={styles.picker}>
            <Picker selectedValue={value} onValueChange={onChange}>
              <Picker.Item label={`Choose a ${field.label.toLowerCase()}`} value="" />
              {field.options.map((option) => (
                <Picker.Item key={option} label={option} value={option} />
              ))}
            </Picker>
          </Host>
        </View>
      ) : (
        <TextInput
          ref={ref}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.muted}
          accessibilityLabel={label}
          accessibilityHint={error}
          autoCapitalize="words"
          autoCorrect={false}
          {...INPUT_HINTS[field.key]}
          {...submit}
          style={[
            styles.box,
            box,
            theme.type.body,
            { color: theme.colors.ink },
          ]}
        />
      )}
      {error ? (
        <Text variant="meta" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: line.input, justifyContent: 'center' },
  picker: { alignSelf: 'flex-start' },
});
