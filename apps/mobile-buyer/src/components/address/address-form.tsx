import { Host, Picker } from '@expo/ui';
import type { AddressConfig, AddressField, AddressFieldKey, AddressFormErrors, AddressFormValues } from '@oja/domain';
import { line, MAX_FONT_SCALE, Text, useTheme } from '@oja/ui';
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
}: Readonly<{
  config: AddressConfig;
  values: AddressFormValues;
  errors: AddressFormErrors;
  onChange: (key: AddressFieldKey, value: string) => void;
}>) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[4] }}>
      {config.fields.map((field) => (
        <Field
          key={field.key}
          field={field}
          value={values[field.key] ?? ''}
          error={errors[field.key]}
          placeholder={field.key === 'phone' ? config.phone.placeholder : field.placeholder}
          onChange={(value) => onChange(field.key, value)}
        />
      ))}
    </View>
  );
}

function Field({
  field,
  value,
  error,
  placeholder,
  onChange,
}: Readonly<{
  field: AddressField;
  value: string;
  error: string | undefined;
  placeholder: string | undefined;
  onChange: (value: string) => void;
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
