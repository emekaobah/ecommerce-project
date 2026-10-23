import {
  addressFromForm,
  formFromLookup,
  mapCentre,
  type AddressConfig,
  type AddressFieldKey,
  type AddressFormErrors,
  type AddressFormValues,
  type LookedUpPlace,
  type Pin,
} from '@oja/domain';
import { Button, InlineNote, line, ListRow, MAX_FONT_SCALE, Text, useTheme } from '@oja/ui';
import * as Location from 'expo-location';
import { useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import {
  MIN_SEARCH_LENGTH,
  newLookupSession,
  useAddressAt,
  useAddressSuggestions,
  usePlaceAddress,
  type LookupFor,
} from '@/api/address-lookup';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

import { refusalMessage } from '@/api/checkout';

import { AddressForm } from './address-form';
import { PinMap, type PinRequest } from './pin-map';

/** Filled on the map's sheet, beside the pin they help the rider and courier find. */
const SHEET_FIELDS = new Set<string>(['metadata.landmark', 'phone'] satisfies AddressFieldKey[]);

/** Where the buyer is, once they allow it; null when location is off. */
async function currentPosition(): Promise<Pin | null> {
  const { granted } = await Location.requestForegroundPermissionsAsync();
  if (!granted) return null;
  const { coords } = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  return { latitude: coords.latitude, longitude: coords.longitude };
}

/**
 * The delivery address (ADR 0002): search with Google or use the current location, which
 * fills the country's form; then confirm the pin on the map, whose sheet takes the rider's
 * landmark and the courier's phone. "Enter manually" is the plain form, but the pin is still
 * confirmed before saving. `onSave` gets the confirmed pin once the whole form is valid.
 * `locateOnOpen` starts with the current location, for a buyer who chose it before opening this.
 */
export function AddressEntry({
  lookup,
  config,
  values,
  errors,
  pin,
  onChange,
  onPlace,
  onPin,
  validate,
  onSave,
  saving,
  saveError,
  saveLabel = 'Confirm address',
  stepLabel,
  locateOnOpen = false,
  children,
}: Readonly<{
  lookup: LookupFor;
  config: AddressConfig;
  values: AddressFormValues;
  errors: AddressFormErrors;
  pin: Pin | null;
  onChange: (key: AddressFieldKey, value: string) => void;
  /** The form's location fields, filled from a place found by search or location. */
  onPlace: (values: AddressFormValues) => void;
  /** The confirmed pin; null when a new place makes the old one stale. */
  onPin: (pin: Pin | null) => void;
  /** Shows what each wrong field needs; false while any is wrong. */
  validate: () => boolean;
  onSave: (pin: Pin) => void;
  saving: boolean;
  saveError: Error | null;
  saveLabel?: string;
  /** "Step 1 of 3", on the map at checkout. */
  stepLabel?: string;
  /** Locate the buyer as soon as the entry opens, as tapping "Use my current location" does. */
  locateOnOpen?: boolean;
  /** Shown above the save button, e.g. whether to keep the address for next time. */
  children?: ReactNode;
}>) {
  const theme = useTheme();
  const [mode, setMode] = useState<'search' | 'form'>(values.address_1 ? 'form' : 'search');
  const [pinRequest, setPinRequest] = useState<PinRequest | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [locating, setLocating] = useState(locateOnOpen);

  /** A new place: its address fills the form, and the old pin no longer marks it. */
  const fill = (place: LookedUpPlace | null) => {
    if (place) onPlace(formFromLookup(place, config.countryCode));
    onPin(null);
    setMode('form');
  };

  /** What's wrong with the form, apart from the fields on the map's sheet. */
  const formErrors = () => {
    const checked = addressFromForm(values, config.countryCode);
    return checked.ok ? [] : Object.keys(checked.errors).filter((key) => !SHEET_FIELDS.has(key));
  };

  // Confirming the pin saves the address once it's whole; a field off the sheet that's wrong
  // sends the buyer back to the form, with what it needs.
  const confirmPin = (confirmed: Pin) => {
    onPin(confirmed);
    if (!validate()) {
      if (formErrors().length) {
        setPinRequest(null);
        setMode('form');
      }
      return;
    }
    onSave(confirmed);
  };

  const addressAt = useAddressAt(lookup);
  /** Fills the form from where the buyer is; `locating` is already on. */
  const locate = async () => {
    try {
      const here = await currentPosition();
      if (!here) {
        setNotice('Location is off. Search for your address, or turn location on in Settings.');
        return;
      }
      const place = await addressAt.mutateAsync(here).catch(() => null);
      if (!place) setNotice("We couldn't find an address where you are. Fill it in below, then check the pin.");
      fill(place);
      // The pin starts where the buyer is, not at the address Google found nearby.
      setPinRequest({ at: here, zoom: 'place' });
    } finally {
      setLocating(false);
    }
  };
  const locateMe = () => {
    setNotice(null);
    setLocating(true);
    void locate();
  };
  // Opened to locate: `locating` starts on, so the button shows it before the permission prompt.
  const locateOnce = useEffectEvent(() => void locate());
  useEffect(() => {
    if (locateOnOpen) locateOnce();
  }, [locateOnOpen]);

  /** The map for a pin the buyer places by hand: where they are, else their state, else the country. */
  const placePinByHand = async () => {
    const here = await currentPosition().catch(() => null);
    if (here) {
      setPinRequest({ at: here, zoom: 'place' });
      return;
    }
    const { zoom, ...centre } = mapCentre(values.province, config.countryCode);
    setPinRequest({ at: centre, zoom });
  };

  // The form's fields first, then the pin, the landmark and the phone on the map.
  const toMap = () => {
    if (formErrors().length) {
      validate();
      return;
    }
    if (pin) setPinRequest({ at: pin, zoom: 'place' });
    else void placePinByHand();
  };

  return (
    <View style={{ gap: theme.space[4] }}>
      {mode === 'search' ? (
        <AddressSearch
          lookup={lookup}
          onFound={(place) => {
            setNotice(null);
            fill(place);
            setPinRequest({ at: place.location, zoom: 'place' });
          }}
        />
      ) : null}

      {mode === 'search' ? (
        <View style={{ gap: theme.space[2] }}>
          <Button
            label="Use my current location"
            variant="secondary"
            onPress={locateMe}
            loading={locating}
          />
          <Button label="Can't find it? Enter manually" variant="link" onPress={() => setMode('form')} />
        </View>
      ) : null}

      {notice ? <InlineNote>{notice}</InlineNote> : null}

      {mode === 'form' ? (
        <>
          <Button
            label="Search for an address"
            variant="link"
            onPress={() => {
              onPin(null);
              setMode('search');
            }}
          />
          <AddressForm
            config={{ ...config, fields: config.fields.filter((field) => !SHEET_FIELDS.has(field.key)) }}
            values={values}
            errors={errors}
            onChange={onChange}
          />
          <Text tone="muted">{"Next, you'll confirm the pin on the map and add a landmark for the rider."}</Text>
          {children}
          <Button label="Continue to the map" size="main" onPress={toMap} loading={saving} />
        </>
      ) : null}

      <PinMap
        request={pinRequest}
        title={values.address_1 ?? ''}
        place={[values.city, values.province].filter(Boolean).join(', ')}
        landmark={{
          value: values['metadata.landmark'] ?? '',
          error: errors['metadata.landmark'],
          onChange: (value) => onChange('metadata.landmark', value),
        }}
        phone={{ value: values.phone ?? '', error: errors.phone, onChange: (value) => onChange('phone', value) }}
        stepLabel={stepLabel}
        confirmLabel={saveLabel}
        saving={saving}
        problem={saveError ? (refusalMessage(saveError) ?? "Couldn't save the address. Check your connection and try again.") : null}
        onLocate={currentPosition}
        onConfirm={confirmPin}
        onCancel={() => setPinRequest(null)}
      />
    </View>
  );
}

/** Google's suggestions as the buyer types; choosing one looks up its address. */
function AddressSearch({ lookup, onFound }: Readonly<{ lookup: LookupFor; onFound: (place: LookedUpPlace) => void }>) {
  const theme = useTheme();
  const [input, setInput] = useState('');
  const [session, setSession] = useState(newLookupSession);
  const settled = useDebouncedValue(input, 300);
  const suggestions = useAddressSuggestions(lookup, session, settled);
  const placeAddress = usePlaceAddress(lookup);

  const choose = (placeId: string) =>
    placeAddress.mutate(
      { placeId, sessionToken: session },
      {
        onSuccess: (place) => {
          // A chosen place ends Google's session; the next search starts another.
          setSession(newLookupSession());
          setInput('');
          onFound(place);
        },
      }
    );

  const error = placeAddress.error ?? suggestions.error;
  const list = settled.trim().length >= MIN_SEARCH_LENGTH ? suggestions.data : undefined;
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="strong">Find your address</Text>
      <TextInput
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        testID="address-search"
        value={input}
        onChangeText={setInput}
        placeholder="Street, estate or area"
        placeholderTextColor={theme.colors.muted}
        accessibilityLabel="Find your address"
        autoCorrect={false}
        autoFocus
        style={[
          styles.box,
          theme.type.body,
          {
            minHeight: theme.hitArea,
            borderRadius: theme.radius.md,
            borderColor: theme.colors.control,
            paddingHorizontal: theme.space[4],
            color: theme.colors.ink,
          },
        ]}
      />
      {placeAddress.isPending ? (
        <Text tone="muted" accessibilityLiveRegion="polite">
          Finding the address…
        </Text>
      ) : null}
      {!list && suggestions.isFetching ? <Text tone="muted">Searching…</Text> : null}
      {list?.map((suggestion) => (
        <ListRow
          key={suggestion.place_id}
          title={suggestion.main_text}
          subtitle={suggestion.secondary_text}
          onPress={() => choose(suggestion.place_id)}
        />
      ))}
      {list?.length === 0 ? (
        <Text tone="muted">No matches. Try the street name and area, or enter it manually.</Text>
      ) : null}
      {list?.length ? (
        <Text variant="meta" tone="muted">
          Powered by Google
        </Text>
      ) : null}
      {error ? <InlineNote>{"Couldn't look up the address. Check your connection, or enter it manually."}</InlineNote> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: line.input, justifyContent: 'center' },
});
