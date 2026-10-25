import {
  addressFormValues,
  checkoutAddressOf,
  contactFromForm,
  getAddressConfig,
  nameFromForm,
  savedAddressFor,
  type AddressConfig,
  type AddressFieldKey,
  type AddressFormErrors,
  type AddressFormValues,
  type AddressStep as AddressStepState,
  type BuyerDetails,
  type Pin,
  type PinnedDeliveryAddress,
  type ReceiverName,
} from '@oja/domain';
import { Button, InlineNote, RadioOption, Skeleton, StatusChip, Text, useTheme } from '@oja/ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { SavedAddressRecord } from '@/api/addresses';
import type { Checkout, CheckoutContact, usePrepareCheckout } from '@/api/checkout';
import { useFailureMessage } from '@/api/errors';
import { AddressCard } from '@/components/address/address-card';
import { AddressEntry } from '@/components/address/address-entry';
import { AddressForm } from '@/components/address/address-form';
import type { useAddressDraft } from '@/components/address/use-address-draft';
import { ToggleRow } from '@/components/toggle-row';

/** Where the order is delivered: the cart's address, the buyer's saved ones, or a new one entered. */
export function DeliveryAddress({
  cartId,
  checkout,
  countryCode,
  step,
  onStep,
  hasCartAddress,
  saved,
  saveError,
  prepare,
  entry,
  savesNew,
  saveNew,
  onSaveNew,
  onChoose,
  onEnter,
  onEntered,
}: Readonly<{
  cartId: string;
  checkout: Checkout;
  countryCode: string;
  step: AddressStepState;
  onStep: (step: AddressStepState | null) => void;
  hasCartAddress: boolean;
  saved: SavedAddressRecord[] | undefined;
  saveError: Error | null;
  prepare: ReturnType<typeof usePrepareCheckout>;
  entry: ReturnType<typeof useAddressDraft>['entry'];
  /** Whether a new address can be saved to the buyer's addresses (not when pinning a saved one). */
  savesNew: boolean;
  saveNew: boolean;
  onSaveNew: (save: boolean) => void;
  onChoose: (address: PinnedDeliveryAddress) => void;
  onEnter: (from: SavedAddressRecord | null) => void;
  onEntered: (pin: Pin) => void;
}>) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[3] }}>
      {/* The header names the step. */}
      <View style={[styles.spread, { gap: theme.space[3] }]}>
        <Text weight="bold" tone="muted">
          {step === 'chosen' ? 'Deliver to' : 'Where should we deliver?'}
        </Text>
        <AddressStepLink
          step={step}
          busy={prepare.isPending}
          hasSaved={!!saved?.length}
          hasCartAddress={hasCartAddress}
          onStep={(next) => onStep(next === 'chosen' ? null : next)}
        />
      </View>
      {step === 'starting' ? (
        <View accessible accessibilityLabel="Getting your address" style={{ gap: theme.space[2] }}>
          <Skeleton width="60%" height={theme.type.body.fontSize} />
          <Skeleton width="80%" height={theme.type.meta.fontSize} />
        </View>
      ) : null}
      {step === 'chosen' && checkout.shipping_address ? (
        <AddressCard address={checkout.shipping_address} />
      ) : null}
      {step === 'chosen' && saveError ? (
        <InlineNote>{"Couldn't save it to your addresses. It's still your delivery address for this order."}</InlineNote>
      ) : null}
      {step === 'choosing' && saved ? (
        <SavedAddressPicker
          addresses={saved}
          chosenId={savedAddressFor(saved, checkout.shipping_address, countryCode)}
          countryCode={countryCode}
          choosing={prepare.isPending ? (prepare.variables?.shippingAddress ?? undefined) : undefined}
          error={prepare.error}
          onChoose={onChoose}
          onPin={onEnter}
          onAdd={() => onEnter(null)}
        />
      ) : null}
      {step === 'entering' ? (
        <AddressEntry
          lookup={{ cart_id: cartId }}
          {...entry}
          onSave={onEntered}
          saving={prepare.isPending}
          saveError={prepare.error}
          stepLabel="Step 1 of 3">
          {savesNew ? <ToggleRow label="Save to my addresses" value={saveNew} onChange={onSaveNew} /> : null}
        </AddressEntry>
      ) : null}
    </View>
  );
}

/**
 * The link beside "Delivery address": change the cart's address, go back to the saved ones
 * from a new one, or keep the cart's address after all.
 */
function AddressStepLink({
  step,
  busy,
  hasSaved,
  hasCartAddress,
  onStep,
}: Readonly<{
  step: AddressStepState;
  busy: boolean;
  hasSaved: boolean;
  hasCartAddress: boolean;
  onStep: (step: AddressStepState) => void;
}>) {
  if (busy || step === 'starting') return null;
  if (step === 'chosen') {
    return <Button label="Change" variant="link" onPress={() => onStep(hasSaved ? 'choosing' : 'entering')} />;
  }
  if (step === 'entering' && hasSaved) {
    return <Button label="Saved addresses" variant="link" onPress={() => onStep('choosing')} />;
  }
  return hasCartAddress ? <Button label="Cancel" variant="link" onPress={() => onStep('chosen')} /> : null;
}

/**
 * The buyer's saved addresses to deliver to (#18), the one the cart has chosen. One without a
 * pin is pinned first; "Add a new address" opens the entry.
 */
function SavedAddressPicker({
  addresses,
  chosenId,
  countryCode,
  choosing,
  error,
  onChoose,
  onPin,
  onAdd,
}: Readonly<{
  addresses: SavedAddressRecord[];
  chosenId: string | null;
  countryCode: string;
  /** The address being set on the cart, shown as chosen meanwhile. */
  choosing: PinnedDeliveryAddress | undefined;
  error: Error | null;
  onChoose: (address: PinnedDeliveryAddress) => void;
  onPin: (saved: SavedAddressRecord) => void;
  onAdd: () => void;
}>) {
  const theme = useTheme();
  const busy = !!choosing;
  const failure = useFailureMessage(error, "Couldn't use that address. Check your connection and try again.", {
    400: "That address can't be used for this order. Check its pin, or try another.",
  });
  return (
    <View style={{ gap: theme.space[2] }} accessibilityRole="radiogroup" accessibilityLabel="Delivery address">
      {addresses.map((saved) => {
        const address = checkoutAddressOf(saved, countryCode);
        const selected = choosing ? savedAddressFor([saved], choosing, countryCode) !== null : saved.id === chosenId;
        return (
          <RadioOption key={saved.id} selected={selected} disabled={busy} onPress={() => (address ? onChoose(address) : onPin(saved))}>
            <View style={{ gap: theme.space[2] }}>
              <AddressCard address={saved} badge={saved.is_default_shipping ? <StatusChip label="Default" tone="info" icon={null} /> : null} />
              {address ? null : <Text tone="accent">Place its pin on the map to deliver here</Text>}
            </View>
          </RadioOption>
        );
      })}
      {failure ? <InlineNote>{failure}</InlineNote> : null}
      <Button label="Add a new address" variant="secondary" onPress={onAdd} disabled={busy} />
    </View>
  );
}

/** The buyer's name and phone from their account, when it has them all. */
export function contactOf(customer: { first_name?: string | null; last_name?: string | null; phone?: string | null } | null | undefined) {
  const { first_name, last_name, phone } = customer ?? {};
  return first_name && last_name && phone ? { first_name, last_name, phone } : null;
}

const NAME_FIELDS = new Set<string>(['first_name', 'last_name'] satisfies AddressFieldKey[]);
const CONTACT_FIELDS = new Set<string>([...NAME_FIELDS, 'phone']);

/** The country's form fields in `keys`, each required: an address may go without them, checkout can't. */
const requiredFields = (config: AddressConfig, keys: Set<string>) =>
  config.fields.filter((field) => keys.has(field.key)).map((field) => ({ ...field, required: true }));

/**
 * The buyer's name, asked for when neither the delivery address nor their account has one
 * (#101): the courier hands the order over by name. Checkout keeps it on the account.
 */
export function ReceiverNameForm({
  countryCode,
  address,
  buyer,
  onSave,
  onChangeAddress,
}: Readonly<{
  countryCode: string;
  address: PinnedDeliveryAddress;
  /** The account, whose half a name (a first name only) fills the form. */
  buyer: BuyerDetails | undefined;
  onSave: (name: ReceiverName) => void;
  onChangeAddress: () => void;
}>) {
  const theme = useTheme();
  const config = getAddressConfig(countryCode);
  const fields = { ...config, fields: requiredFields(config, NAME_FIELDS) };
  const [values, setValues] = useState<AddressFormValues>(() => addressFormValues(null, countryCode, buyer));
  const [errors, setErrors] = useState<AddressFormErrors>({});
  const save = () => {
    const checked = nameFromForm(values);
    if (!checked.ok) return setErrors(checked.errors);
    onSave(checked.name);
  };
  return (
    <View style={{ gap: theme.space[3] }}>
      <View style={[styles.spread, { gap: theme.space[3] }]}>
        <Text weight="bold" tone="muted">
          Deliver to
        </Text>
        <Button label="Change" variant="link" onPress={onChangeAddress} />
      </View>
      <AddressCard address={address} />
      <Text variant="heading">Your name</Text>
      <Text tone="muted">{"The courier asks for you by name. We'll keep it on your account for next time."}</Text>
      <AddressForm
        config={fields}
        values={values}
        errors={errors}
        onChange={(key, value) => {
          setValues((current) => ({ ...current, [key]: value }));
          setErrors(({ [key]: _fixed, ...rest }) => rest);
        }}
        onSubmit={save}
      />
      <Button label="Continue" size="main" onPress={save} />
    </View>
  );
}

/**
 * When every shop's order is collected (#12), checkout asks for no address: only the buyer's
 * name and phone, for the shops to hand the orders to.
 */
export function ContactDetails({
  countryCode,
  contact,
  buyer,
  editing,
  saving,
  error,
  onEdit,
  onSave,
}: Readonly<{
  countryCode: string;
  contact: CheckoutContact | null;
  /** The buyer's account, whose name and phone fill what it has of the form. */
  buyer: BuyerDetails | undefined;
  editing: boolean;
  saving: boolean;
  error: Error | null;
  onEdit: () => void;
  onSave: (contact: CheckoutContact) => void;
}>) {
  const theme = useTheme();
  const failure = useFailureMessage(error, "Couldn't save your details. Check your connection and try again.", {
    400: 'Give your name and phone number for the shop.',
  });
  const config = getAddressConfig(countryCode);
  const fields = { ...config, fields: requiredFields(config, CONTACT_FIELDS) };
  // Starts with what the account has, even just a phone or a first name.
  const [values, setValues] = useState<AddressFormValues>(() => addressFormValues(null, countryCode, contact ?? buyer));
  const [errors, setErrors] = useState<AddressFormErrors>({});
  const save = () => {
    const checked = contactFromForm(values, countryCode);
    if (!checked.ok) return setErrors(checked.errors);
    onSave(checked.contact);
  };
  return (
    <View style={{ gap: theme.space[3] }}>
      <View style={[styles.spread, { gap: theme.space[3] }]}>
        <Text variant="heading">Your details</Text>
        {editing || saving ? null : <Button label="Change" variant="link" onPress={onEdit} />}
      </View>
      <Text tone="muted">
        {"You collect every order in store, so there's no delivery address. Each shop hands your order to whoever shows its code."}
      </Text>
      {editing ? (
        <>
          <AddressForm
            config={fields}
            values={values}
            errors={errors}
            onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
            onSubmit={save}
          />
          {failure ? <InlineNote>{failure}</InlineNote> : null}
          <Button label="Continue" size="main" onPress={save} loading={saving} />
        </>
      ) : (
        contact && (
          <View style={{ gap: theme.space[1] }}>
            <Text weight="bold">{`${contact.first_name} ${contact.last_name}`}</Text>
            <Text tone="muted">{contact.phone}</Text>
          </View>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
