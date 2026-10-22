import {
  formFromLookup,
  mapCentre,
  type AddressConfig,
  type AddressFieldKey,
  type AddressFormErrors,
  type AddressFormValues,
  type LookedUpPlace,
  type Pin,
} from '@oja/domain';
import { Button, line, ListRow, MAX_FONT_SCALE, Text, useTheme } from '@oja/ui';
import * as Location from 'expo-location';
import { useState, type ReactNode } from 'react';
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

import { AddressForm } from './address-form';
import { PinMap, type PinRequest } from './pin-map';


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
 * fills the country's form; then confirm a pin on the map. "Enter manually" is the plain form,
 * but the pin is still placed before saving. `onSave` gets the confirmed pin once the form is valid.
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
  saveLabel = 'Use this address',
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
  /** Shown above the save button, e.g. whether to keep the address for next time. */
  children?: ReactNode;
}>) {
  const theme = useTheme();
  const [mode, setMode] = useState<'search' | 'form'>(values.address_1 ? 'form' : 'search');
  const [pinRequest, setPinRequest] = useState<PinRequest | null>(null);
  // Saving waits for the pin when the buyer hasn't placed one yet.
  const [saveOnConfirm, setSaveOnConfirm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  /** A new place: its address fills the form, and the old pin no longer marks it. */
  const fill = (place: LookedUpPlace | null) => {
    if (place) onPlace(formFromLookup(place, config.countryCode));
    onPin(null);
    setMode('form');
  };

  const confirmPin = (confirmed: Pin) => {
    setPinRequest(null);
    onPin(confirmed);
    if (saveOnConfirm) {
      setSaveOnConfirm(false);
      onSave(confirmed);
    }
  };

  const addressAt = useAddressAt(lookup);
  const locateMe = async () => {
    setNotice(null);
    setLocating(true);
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

  const save = () => {
    if (!validate()) return;
    if (pin) {
      onSave(pin);
      return;
    }
    setSaveOnConfirm(true);
    void placePinByHand();
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
            onPress={() => void locateMe()}
            loading={locating}
          />
          <Button label="Can't find it? Enter manually" variant="link" onPress={() => setMode('form')} />
        </View>
      ) : null}

      {notice ? (
        <Text tone="muted" accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}

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
          <AddressForm config={config} values={values} errors={errors} onChange={onChange} />
          <View style={[styles.spread, { gap: theme.space[4] }]}>
            <Text tone="muted" style={styles.shrink}>
              {pin ? 'Delivery pin placed on the map.' : "You'll place a pin on the map before saving."}
            </Text>
            {pin ? (
              <Button label="Move pin" variant="link" onPress={() => setPinRequest({ at: pin, zoom: 'place' })} />
            ) : null}
          </View>
          {saveError ? (
            <Text tone="danger" accessibilityLiveRegion="polite">
              {saveError.message}
            </Text>
          ) : null}
          {children}
          <Button label={saveLabel} onPress={save} loading={saving} />
        </>
      ) : null}

      <PinMap
        request={pinRequest}
        onConfirm={confirmPin}
        onCancel={() => {
          setPinRequest(null);
          setSaveOnConfirm(false);
        }}
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
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {`Couldn't look up the address: ${error.message}`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: line.input, justifyContent: 'center' },
  spread: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  shrink: { flexShrink: 1 },
});
