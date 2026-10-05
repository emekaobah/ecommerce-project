import { Host, Picker } from '@expo/ui';
import type { AddressConfig, AddressField, AddressFieldKey, AddressFormValues } from '@oja/domain';
import { Text, useTheme } from '@oja/ui';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

type Errors = Partial<Record<AddressFieldKey, string>>;

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
  errors: Errors;
  onChange: (key: AddressFieldKey, value: string) => void;
}>) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space.md }}>
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
    minHeight: theme.touchTarget,
    borderRadius: theme.radius.md,
    borderColor: error ? theme.colors.danger : theme.colors.divider,
    paddingHorizontal: theme.space.md,
  };
  return (
    <View style={{ gap: theme.space.xs }}>
      <Text variant="label">{label}</Text>
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
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textSecondary}
          accessibilityLabel={label}
          accessibilityHint={error}
          autoCapitalize="words"
          autoCorrect={false}
          {...INPUT_HINTS[field.key]}
          style={[
            styles.box,
            box,
            theme.type.body,
            { color: theme.colors.ink, fontFamily: theme.fontFamily },
          ]}
        />
      )}
      {error ? (
        <Text variant="caption" style={{ color: theme.colors.danger }} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, justifyContent: 'center' },
  picker: { alignSelf: 'flex-start' },
});
