import {
  addressFormValues,
  addressFromForm,
  getAddressConfig,
  pinOf,
  type AddressFieldKey,
  type AddressFormErrors,
  type AddressFormValues,
  type BuyerDetails,
  type Pin,
  type StoredAddress,
} from '@oja/domain';
import { useCallback, useState } from 'react';



/**
 * An address being entered or edited with `AddressEntry`: the form's values, what each wrong
 * field needs, and the confirmed pin. It starts from `start` (a saved address, or the cart's)
 * keeping its pin, or empty with the buyer's name and phone.
 */
export function useAddressDraft(
  countryCode: string,
  start: StoredAddress | null | undefined,
  buyer?: BuyerDetails
) {
  const config = getAddressConfig(countryCode);
  const [typed, setTyped] = useState<AddressFormValues>(() => addressFormValues(start, countryCode, buyer));
  const [errors, setErrors] = useState<AddressFormErrors>({});
  const [pin, setPin] = useState<Pin | null>(() => pinOf(start));

  // The buyer's profile may load after the form opens; their name and phone fill the fields left blank.
  const fromBuyer = addressFormValues(null, countryCode, buyer);
  const values: AddressFormValues = {
    ...typed,
    first_name: typed.first_name || fromBuyer.first_name || '',
    last_name: typed.last_name || fromBuyer.last_name || '',
    phone: typed.phone || fromBuyer.phone || '',
  };

  /** Starts over from another address (or an empty form), e.g. "Add a new address". */
  const restart = useCallback(
    (from: StoredAddress | null | undefined) => {
      setTyped(addressFormValues(from, countryCode));
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
        setTyped((current) => ({ ...current, [key]: value }));
        setErrors(({ [key]: _fixed, ...rest }) => rest);
      },
      onPlace: (found: AddressFormValues) => {
        setTyped((current) => ({ ...current, ...found }));
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
