import {
  addressFormValues,
  addressFromForm,
  getAddressConfig,
  pinOf,
  type AddressFieldKey,
  type AddressFormValues,
  type Pin,
  type StoredAddress,
} from '@oja/domain';
import { useCallback, useState } from 'react';

type Name = { first_name?: string | null; last_name?: string | null };

/**
 * An address being entered or edited with `AddressEntry`: the form's values, what each wrong
 * field needs, and the confirmed pin. It starts from `start` (a saved address, or the cart's)
 * keeping its pin, or empty with the buyer's name.
 */
export function useAddressDraft(countryCode: string, start: StoredAddress | null | undefined, name?: Name) {
  const config = getAddressConfig(countryCode);
  const [typed, setValues] = useState<AddressFormValues>(() => addressFormValues(start, countryCode, name));
  const [errors, setErrors] = useState<Partial<Record<AddressFieldKey, string>>>({});
  const [pin, setPin] = useState<Pin | null>(() => pinOf(start));

  // The buyer's profile may load after the form opens; their name fills the name fields left blank.
  const { first_name, last_name } = name ?? {};
  const values: AddressFormValues = {
    ...typed,
    first_name: typed.first_name || first_name || '',
    last_name: typed.last_name || last_name || '',
  };

  /** Starts over from another address (or an empty form), e.g. "Add a new address". */
  const restart = useCallback(
    (from: StoredAddress | null | undefined) => {
      setValues(addressFormValues(from, countryCode));
      setErrors({});
      setPin(pinOf(from));
    },
    [countryCode]
  );

  return {
    values,
    pin,
    restart,
    /** The form checked and turned into an address with the pin confirmed for it. */
    pinned: (confirmed: Pin) => addressFromForm(values, countryCode, confirmed),
    /** What `AddressEntry` takes to show and change the draft. */
    entry: {
      config,
      values,
      errors,
      pin,
      onChange: (key: AddressFieldKey, value: string) => {
        setValues((current) => ({ ...current, [key]: value }));
        setErrors(({ [key]: _fixed, ...rest }) => rest);
      },
      onPlace: (found: AddressFormValues) => {
        setValues((current) => ({ ...current, ...found }));
        setErrors({});
      },
      onPin: setPin,
      validate: () => {
        const result = addressFromForm(values, countryCode);
        if (!result.ok) setErrors(result.errors);
        return result.ok;
      },
    },
  };
}
