import { useAuth } from '@clerk/expo';
import {
  addressFromForm,
  addressStep,
  checkoutAddressOf,
  getAddressConfig,
  toE164,
  type AddressFieldKey,
  type AddressFormErrors,
  type AddressFormValues,
  deliveryEstimate,
  formatMoney,
  preselectedAddress,
  priceChangeMessage,
  savedAddressFor,
  type AddressStep,
  type DeliveryTag,
  type PaymentReturn,
  type Pin,
  type PinnedDeliveryAddress,
  type PriceChange,
} from '@oja/domain';
import { Button, buyerTheme, EmptyState, ErrorState, LoadingState, StatusChip, Text, useTheme } from '@oja/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { useSaveAddress, useSavedAddresses, type SavedAddressRecord } from '@/api/addresses';
import {
  useCheckout,
  useChooseDelivery,
  usePrepareCheckout,
  useStartPayment,
  type Checkout,
  type CheckoutContact,
  type CheckoutSellerGroup,
} from '@/api/checkout';
import { useCustomer } from '@/api/customer';
import { isAlreadyPaid } from '@/api/errors';
import { AddressCard } from '@/components/address/address-card';
import { AddressEntry } from '@/components/address/address-entry';
import { AddressForm } from '@/components/address/address-form';
import { PickupDetails } from '@/components/pickup';
import { RadioOption } from '@/components/radio-option';
import { useAddressDraft } from '@/components/address/use-address-draft';
import { ToggleRow } from '@/components/toggle-row';
import { useCartSession } from '@/cart/cart-provider';
import { PerishableChip, PerishableRule } from '@/components/perishable';
import { ShopStatusBadge } from '@/components/shop-status';
import { env } from '@/config/env';
import { useRegion } from '@/region/region-provider';

/**
 * Where Paystack sends the buyer back to. Paystack only redirects to an http(s) URL, so this is
 * a page on the API that the payment WebView catches and never loads (see pay-screen).
 */
export const PAYMENT_RETURN_URL = `${env.apiUrl}/paystack/return`;

/** How the buyer came back from Paystack without paying: Paystack's cancel, or closing its page. */
type PaymentLeft = Extract<PaymentReturn['kind'], 'cancelled'> | 'closed';

/**
 * Checkout: the delivery address, then each shop's items and delivery, then pay with Paystack.
 * `payment=cancelled` is set when the buyer comes back from Paystack without paying.
 */
export function CheckoutScreen() {
  const { cartId } = useCartSession();
  const { region } = useRegion();
  const checkout = useCheckout(cartId);

  const emptyCart = (
    <EmptyState
      title="Your cart is empty"
      message="Add something from a shop to check out."
      action={{ label: 'Start shopping', onPress: () => router.navigate('/') }}
    />
  );
  if (cartId === null) return emptyCart;
  if (checkout.error && !checkout.data) {
    return (
      <ErrorState title="Couldn't load checkout" message={checkout.error.message} onRetry={() => void checkout.refetch()} />
    );
  }
  const countryCode = region?.countries?.[0]?.iso_2;
  if (!cartId || !checkout.data || !countryCode) return <LoadingState />;
  if (checkout.data.sellers.length === 0) return emptyCart;
  return <CheckoutForm cartId={cartId} checkout={checkout.data} countryCode={countryCode} />;
}

function CheckoutForm({
  cartId,
  checkout,
  countryCode,
}: Readonly<{ cartId: string; checkout: Checkout; countryCode: string }>) {
  const theme = useTheme();
  const { userId } = useAuth();
  const customer = useCustomer(userId);
  const saved = useSavedAddresses(userId);
  const prepare = usePrepareCheckout(cartId);
  const saveToAddressBook = useSaveAddress(countryCode);

  /** The step the buyer moved checkout to themselves (changing the address); null follows the cart. */
  const [buyerStep, setBuyerStep] = useState<AddressStep | null>(null);
  const draft = useAddressDraft(countryCode, checkout.shipping_address, customer.data ?? undefined);
  /** The saved address without a pin that the buyer is placing one for; the entry then updates it. */
  const [pinningSaved, setPinningSaved] = useState<SavedAddressRecord | null>(null);
  const [saveNew, setSaveNew] = useState(true);

  // The cart's address, as checkout can quote it again; null for one saved before pins were required.
  const cartAddress = checkout.shipping_address ? checkoutAddressOf(checkout.shipping_address, countryCode) : null;
  const hasSaved = !!saved.data?.length;
  const step =
    buyerStep ??
    addressStep({
      cartAddress: checkout.shipping_address,
      readyToPay: checkout.ready_to_pay,
      saved: saved.data,
      savedFailed: !!saved.error,
      countryCode,
    });

  // The shops the buyer chose to collect from (#12). One checkout switched to pickup itself (fresh
  // items no courier brings in time) isn't among them: it is quoted for delivery again.
  const chosenPickup = checkout.sellers.flatMap((g) => (g.seller && g.method === 'pickup' && !g.pickup_note ? [g.seller.id] : []));
  // Those switched stay collected while nothing else is delivered: checkout then needs no address.
  const switchedToPickup = checkout.sellers.flatMap((g) => (g.seller && g.method === 'pickup' && g.pickup_note ? [g.seller.id] : []));
  const collectsAll = (ids: string[]) => checkout.sellers.every((g) => g.seller && (ids.includes(g.seller.id) || switchedToPickup.includes(g.seller.id)));
  /** A change of method waiting for what checkout needs first: an address, or the buyer's details. */
  const [pendingPickup, setPendingPickup] = useState<string[] | null>(null);
  const pickup = pendingPickup ?? chosenPickup;
  const everyCollected = collectsAll(pickup);

  const deliverTo = (address: PinnedDeliveryAddress, onDelivered?: () => void) =>
    prepare.mutate(
      { shippingAddress: address, pickup },
      {
        onSuccess: () => {
          setBuyerStep(null);
          setPendingPickup(null);
          onDelivered?.();
        },
      },
    );

  const collectFrom = (contact: CheckoutContact) =>
    prepare.mutate({ contact, pickup }, { onSuccess: () => setPendingPickup(null) });

  /** The buyer chooses how one shop's order reaches them. */
  const chooseMethod = (sellerId: string, method: 'delivery' | 'pickup') => {
    const next = method === 'pickup' ? [...chosenPickup, sellerId] : chosenPickup.filter((id) => id !== sellerId);
    const allCollected = collectsAll(next);
    const contact = checkout.contact ?? contactOf(customer.data);
    if (allCollected && contact) return prepare.mutate({ contact, pickup: next });
    if (!allCollected && cartAddress) return prepare.mutate({ shippingAddress: cartAddress, pickup: next });
    // Checkout needs the buyer's details, or an address, first.
    setPendingPickup(next);
    if (!allCollected) setBuyerStep(hasSaved ? 'choosing' : 'entering');
  };

  const chooseAddress = useCallback(() => setBuyerStep('choosing'), []);
  useAutomaticQuotes({
    step,
    saved: saved.data,
    countryCode,
    cartAddress,
    checkout,
    pickup,
    everyCollected,
    prepare,
    onFailed: chooseAddress,
  });

  const enterAddress = (from: SavedAddressRecord | null) => {
    draft.restart(from);
    setPinningSaved(from);
    setBuyerStep('entering');
  };
  // Once checkout takes the address: a saved one getting its pin is updated, and a new one is
  // saved when the buyer asks, unless they already have it.
  const deliverToEntered = (confirmed: Pin) => {
    const result = draft.pinned(confirmed);
    if (!result.ok) return;
    const address = result.address;
    deliverTo(address, () => {
      if (pinningSaved) saveToAddressBook.mutate({ id: pinningSaved.id, address });
      else if (saveNew && !savedAddressFor(saved.data ?? [], address, countryCode)) {
        saveToAddressBook.mutate({ address, makeDefault: !hasSaved });
      }
    });
  };
  const [editingContact, setEditingContact] = useState(false);
  const editing = everyCollected ? editingContact || !checkout.contact || !!pendingPickup : step !== 'chosen';

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={{ backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: theme.space.md, gap: theme.space.lg }}
        keyboardShouldPersistTaps="handled">
        {everyCollected ? (
          <ContactDetails
            countryCode={countryCode}
            contact={checkout.contact ?? contactOf(customer.data)}
            editing={editing}
            saving={prepare.isPending}
            error={prepare.error}
            onEdit={() => setEditingContact(true)}
            onSave={(contact) => {
              setEditingContact(false);
              collectFrom(contact);
            }}
          />
        ) : null}
        <View style={{ gap: theme.space.md, display: everyCollected ? 'none' : 'flex' }}>
          <View style={styles.spread}>
            <Text variant="heading">Delivery address</Text>
            <AddressStepLink
              step={step}
              busy={prepare.isPending}
              hasSaved={hasSaved}
              hasCartAddress={!!cartAddress || checkout.ready_to_pay}
              onStep={(next) => setBuyerStep(next === 'chosen' ? null : next)}
            />
          </View>
          {step === 'starting' ? (
            <Text tone="secondary">Getting your address…</Text>
          ) : null}
          {step === 'chosen' ? (
            <ChosenAddress address={checkout.shipping_address} saveError={saveToAddressBook.error} />
          ) : null}
          {step === 'choosing' && saved.data ? (
            <SavedAddressPicker
              addresses={saved.data}
              chosenId={savedAddressFor(saved.data, checkout.shipping_address, countryCode)}
              countryCode={countryCode}
              choosing={prepare.isPending ? (prepare.variables?.shippingAddress ?? undefined) : undefined}
              error={prepare.error}
              onChoose={(address) => deliverTo(address)}
              onPin={enterAddress}
              onAdd={() => enterAddress(null)}
            />
          ) : null}
          {step === 'entering' ? (
            <AddressEntry
              lookup={{ cart_id: cartId }}
              {...draft.entry}
              onSave={deliverToEntered}
              saving={prepare.isPending}
              saveError={prepare.error}>
              {pinningSaved ? null : <ToggleRow label="Save to my addresses" value={saveNew} onChange={setSaveNew} />}
            </AddressEntry>
          ) : null}
        </View>

        {editing ? null : (
          <CheckoutSummary
            cartId={cartId}
            checkout={checkout}
            choosingMethod={prepare.isPending}
            onChooseMethod={chooseMethod}
          />
        )}
      </ScrollView>
      {editing ? null : <PayBar cartId={cartId} checkout={checkout} prepare={prepare} />}
    </KeyboardAvoidingView>
  );
}

/** The buyer's name and phone from their account, when it has them all. */
function contactOf(customer: { first_name?: string | null; last_name?: string | null; phone?: string | null } | null | undefined) {
  const { first_name, last_name, phone } = customer ?? {};
  return first_name && last_name && phone ? { first_name, last_name, phone } : null;
}

/**
 * When every shop's order is collected (#12), checkout asks for no address: only the buyer's
 * name and phone, for the shops to hand the orders to.
 */
function ContactDetails({
  countryCode,
  contact,
  editing,
  saving,
  error,
  onEdit,
  onSave,
}: Readonly<{
  countryCode: string;
  contact: CheckoutContact | null;
  editing: boolean;
  saving: boolean;
  error: Error | null;
  onEdit: () => void;
  onSave: (contact: CheckoutContact) => void;
}>) {
  const theme = useTheme();
  const config = getAddressConfig(countryCode);
  const fields = { ...config, fields: config.fields.filter((f) => CONTACT_FIELDS.includes(f.key)) };
  const [values, setValues] = useState<AddressFormValues>({
    first_name: contact?.first_name ?? '',
    last_name: contact?.last_name ?? '',
    phone: contact?.phone ?? '',
  });
  const [errors, setErrors] = useState<AddressFormErrors>({});
  const save = () => {
    const checked = addressFromForm(values, countryCode);
    const problems = checked.ok ? {} : Object.fromEntries(Object.entries(checked.errors).filter(([key]) => CONTACT_FIELDS.includes(key as AddressFieldKey)));
    const phone = toE164(values.phone ?? '', countryCode);
    if (Object.keys(problems).length || !phone) return setErrors(problems);
    onSave({ first_name: values.first_name!.trim(), last_name: values.last_name!.trim(), phone });
  };
  return (
    <View style={{ gap: theme.space.md }}>
      <View style={styles.spread}>
        <Text variant="heading">Your details</Text>
        {editing || saving ? null : <Button label="Change" variant="link" onPress={onEdit} />}
      </View>
      <Text tone="secondary">
        {"You collect every order in store, so there's no delivery address. Each shop hands your order to whoever shows its code."}
      </Text>
      {editing ? (
        <>
          <AddressForm
            config={fields}
            values={values}
            errors={errors}
            onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
          />
          {error ? (
            <Text style={{ color: theme.colors.danger }} accessibilityLiveRegion="polite">
              {error.message}
            </Text>
          ) : null}
          <Button label="Continue" onPress={save} loading={saving} />
        </>
      ) : contact ? (
        <Text>{`${contact.first_name} ${contact.last_name} · ${contact.phone}`}</Text>
      ) : null}
    </View>
  );
}

const CONTACT_FIELDS: AddressFieldKey[] = ['first_name', 'last_name', 'phone'];

/** Each shop's part of the order, then the order's totals. */
function CheckoutSummary({
  cartId,
  checkout,
  choosingMethod,
  onChooseMethod,
}: Readonly<{
  cartId: string;
  checkout: Checkout;
  choosingMethod: boolean;
  onChooseMethod: (sellerId: string, method: 'delivery' | 'pickup') => void;
}>) {
  const theme = useTheme();
  return (
    <>
      {checkout.sellers.map((group) => (
        <ShopSummary
          key={group.seller?.id ?? 'gone'}
          cartId={cartId}
          group={group}
          currencyCode={checkout.currency_code}
          choosingMethod={choosingMethod}
          onChooseMethod={onChooseMethod}
        />
      ))}
      <View style={{ gap: theme.space.sm }}>
        <Line label="Items" amount={checkout.item_subtotal} currencyCode={checkout.currency_code} />
        <Line label="Delivery" amount={checkout.shipping_total} currencyCode={checkout.currency_code} />
        <Line label="Total" amount={checkout.total} currencyCode={checkout.currency_code} strong />
        <Text variant="caption" tone="secondary">
          Prices include VAT. Each shop delivers its own items, or hands them over in store.
        </Text>
      </View>
    </>
  );
}

/** The Pay button, with why the last payment didn't start or how the buyer left Paystack. */
function PayBar({
  cartId,
  checkout,
  prepare,
}: Readonly<{ cartId: string; checkout: Checkout; prepare: ReturnType<typeof usePrepareCheckout> }>) {
  const theme = useTheme();
  const { payment: returned } = useLocalSearchParams<{ payment?: PaymentLeft }>();
  const startPayment = useStartPayment(cartId);
  // Both reprice the cart; the lines the latest one repriced are shown until the buyer pays.
  const priceChanges = latestPriceChanges(prepare, startPayment);
  const pay = () =>
    startPayment.mutate(PAYMENT_RETURN_URL, {
      // No payment means a shop's price changed: the buyer sees the new total, then pays again.
      onSuccess: ({ payment }) => {
        if (payment) router.push({ pathname: '/checkout/pay', params: { cartId, url: payment.authorization_url } });
      },
      // The last payment went through: wait for Paystack's confirmation rather than pay twice.
      onError: (error) => {
        if (isAlreadyPaid(error)) router.push({ pathname: '/checkout/confirmation', params: { cartId } });
      },
    });
  const notice = paymentNotice(startPayment.error, returned);

  return (
    <View
      style={{
        padding: theme.space.md,
        gap: theme.space.sm,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        backgroundColor: theme.colors.background,
      }}>
      <PriceChanges changes={priceChanges} currencyCode={checkout.currency_code} />
      {notice ? (
        <Text tone="secondary" accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}
      <Button
        label="Pay with Paystack"
        detail={formatMoney(checkout.total, checkout.currency_code)}
        onPress={pay}
        loading={startPayment.isPending || prepare.isPending}
        disabled={!checkout.ready_to_pay}
      />
    </View>
  );
}

/**
 * The quotes checkout asks for by itself. It starts with the buyer's default address, once.
 * A cart changed since its delivery was quoted (a shop added, a quantity changed) has a shop
 * without rates, so it is quoted again at the cart's address, once. A shop that can't deliver
 * isn't missing rates. If either fails, the buyer
 * chooses an address.
 */
function useAutomaticQuotes({
  step,
  saved,
  countryCode,
  cartAddress,
  checkout,
  pickup,
  everyCollected,
  prepare,
  onFailed,
}: {
  step: AddressStep;
  saved: SavedAddressRecord[] | undefined;
  countryCode: string;
  cartAddress: PinnedDeliveryAddress | null;
  checkout: Checkout;
  /** The shops the buyer collects from, which aren't quoted. */
  pickup: string[];
  /** Every shop is collected: there is nothing to quote. */
  everyCollected: boolean;
  prepare: ReturnType<typeof usePrepareCheckout>;
  onFailed: () => void;
}) {
  const preselecting = useRef(false);
  useEffect(() => {
    const preselected = step === 'starting' && saved && !everyCollected ? preselectedAddress(saved, countryCode) : null;
    if (!preselected || preselecting.current) return;
    preselecting.current = true;
    prepare.mutate({ shippingAddress: preselected.address, pickup }, { onError: onFailed });
  }, [step, saved, countryCode, everyCollected, pickup, prepare, onFailed]);

  // A shop that can't deliver its order (perishables no courier brings in time, #69) says why
  // instead of being quoted again; a shop collected from needs no rates.
  const missingRates =
    !checkout.ready_to_pay &&
    checkout.sellers.some((g) => g.method === 'delivery' && !g.shipping && !g.delivery_unavailable);
  const needsQuote = step === 'chosen' && !everyCollected && missingRates && !!cartAddress && !prepare.isPending;
  const requoted = useRef(false);
  useEffect(() => {
    if (!needsQuote) {
      if (step !== 'chosen') requoted.current = false;
      return;
    }
    if (requoted.current || !cartAddress) return;
    requoted.current = true;
    prepare.mutate({ shippingAddress: cartAddress, pickup }, { onError: onFailed });
  }, [needsQuote, step, cartAddress, pickup, prepare, onFailed]);
}

/** The cart's address once chosen, and why saving it to the buyer's addresses failed, if it did. */
function ChosenAddress({
  address,
  saveError,
}: Readonly<{ address: Checkout['shipping_address']; saveError: Error | null }>) {
  return (
    <>
      {address ? <AddressCard address={address} /> : null}
      {saveError ? (
        <Text tone="secondary" accessibilityLiveRegion="polite">
          {`Couldn't save it to your addresses: ${saveError.message}`}
        </Text>
      ) : null}
    </>
  );
}

/** What to tell the buyer above the Pay button: why starting a payment failed, or how they left Paystack. */
function paymentNotice(error: Error | null, returned: PaymentLeft | undefined): string | null {
  if (error && !isAlreadyPaid(error)) return `Couldn't start the payment: ${error.message}`;
  if (returned === 'cancelled') return "Payment not completed. You haven't been charged. You can try again.";
  if (returned === 'closed') {
    return "You closed the payment page. If you finished paying, your order appears in Orders once Paystack confirms it; otherwise, pay again.";
  }
  return null;
}

type Repricing = { data?: { price_changes: PriceChange[] }; submittedAt: number };

/** The price changes the buyer's latest address save or payment start found. */
function latestPriceChanges(...repricings: Repricing[]): PriceChange[] {
  const [latest] = repricings.filter((r) => r.data).sort((a, b) => b.submittedAt - a.submittedAt);
  return latest?.data?.price_changes ?? [];
}

/** The lines a shop repriced since the buyer added them, so the new total is no surprise. */
function PriceChanges({ changes, currencyCode }: Readonly<{ changes: PriceChange[]; currencyCode: string }>) {
  const theme = useTheme();
  if (!changes.length) return null;
  return (
    <View style={{ gap: theme.space.xs }} accessibilityLiveRegion="polite">
      <Text variant="label">Some prices changed since you added these items</Text>
      {changes.map((change) => (
        <Text key={change.line_item_id} tone="secondary">
          {priceChangeMessage(change, currencyCode)}
        </Text>
      ))}
      <Text tone="secondary">The total below is what you'll pay.</Text>
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
  step: AddressStep;
  busy: boolean;
  hasSaved: boolean;
  hasCartAddress: boolean;
  onStep: (step: AddressStep) => void;
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
 * The buyer's saved addresses to deliver to (#18), the one the cart has outlined. One without
 * a pin is pinned first; "Add a new address" opens the entry.
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
  return (
    <View style={{ gap: theme.space.sm }} accessibilityRole="radiogroup" accessibilityLabel="Delivery address">
      {addresses.map((saved) => {
        const address = checkoutAddressOf(saved, countryCode);
        const selected = choosing ? savedAddressFor([saved], choosing, countryCode) !== null : saved.id === chosenId;
        return (
          <RadioOption
            key={saved.id}
            selected={selected}
            disabled={busy}
            onPress={() => (address ? onChoose(address) : onPin(saved))}>
            <View style={{ gap: theme.space.sm }}>
              <AddressCard
                address={saved}
                badge={saved.is_default_shipping ? <StatusChip label="Default" tone="info" /> : null}
              />
              {address ? null : <Text tone="accent">Place its pin on the map to deliver here</Text>}
            </View>
          </RadioOption>
        );
      })}
      {error ? (
        <Text style={{ color: theme.colors.danger }} accessibilityLiveRegion="polite">
          {error.message}
        </Text>
      ) : null}
      <Button label="Add a new address" variant="secondary" onPress={onAdd} disabled={busy} />
    </View>
  );
}

function ShopSummary({
  cartId,
  group,
  currencyCode,
  choosingMethod,
  onChooseMethod,
}: Readonly<{
  cartId: string;
  group: CheckoutSellerGroup;
  currencyCode: string;
  choosingMethod: boolean;
  onChooseMethod: (sellerId: string, method: 'delivery' | 'pickup') => void;
}>) {
  const theme = useTheme();
  const sellerId = group.seller?.id;
  return (
    <View
      style={{
        gap: theme.space.sm,
        paddingTop: theme.space.md,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
      }}>
      <Text variant="heading">{group.seller?.name ?? 'No longer available'}</Text>
      {/* Closed now: prepared when it opens, or (closed for a while) can't be paid for (ADR 0004). */}
      {group.shop_status ? <ShopStatusBadge status={group.shop_status} withNote /> : null}
      {group.shop_status && !group.shop_status.orderable ? (
        <Text tone="secondary">{`Remove ${group.seller?.name}'s items from your cart to pay for the rest.`}</Text>
      ) : null}
      {group.items.map((item) => (
        <View key={item.id} style={styles.spread}>
          <View style={[styles.shrink, { gap: theme.space.xs }]}>
            <Text numberOfLines={2}>
              {item.quantity} × {item.product_title ?? 'Item'}
            </Text>
            {item.perishable ? <PerishableChip /> : null}
          </View>
          <Text>{formatMoney(item.subtotal, currencyCode)}</Text>
        </View>
      ))}
      {group.perishable && !group.delivery_unavailable ? <PerishableRule /> : null}
      {group.pickup && sellerId ? (
        <View style={{ gap: theme.space.sm }} accessibilityRole="radiogroup" accessibilityLabel={`How to get ${group.seller?.name}'s order`}>
          <RadioOption
            selected={group.method === 'delivery'}
            disabled={choosingMethod}
            onPress={() => group.method !== 'delivery' && onChooseMethod(sellerId, 'delivery')}>
            <Text variant="label">Delivery</Text>
          </RadioOption>
          <RadioOption
            selected={group.method === 'pickup'}
            disabled={choosingMethod}
            onPress={() => group.method !== 'pickup' && onChooseMethod(sellerId, 'pickup')}>
            <Text variant="label">Pickup · Free</Text>
          </RadioOption>
        </View>
      ) : null}
      {group.method === 'pickup' && group.pickup ? (
        <View style={{ gap: theme.space.xs }}>
          <Text variant="label">Collect in store</Text>
          {group.pickup_note ? <Text accessibilityLiveRegion="polite">{group.pickup_note}</Text> : null}
          <PickupDetails place={group.pickup} note={group.pickup.hold_notice} />
        </View>
      ) : (
        <DeliveryChoices cartId={cartId} group={group} currencyCode={currencyCode} />
      )}
    </View>
  );
}

const TAG_LABELS: Record<DeliveryTag, string> = { best_value: 'Best value', cheapest: 'Cheapest', fastest: 'Fastest' };

/**
 * The shop's courier rates (#23): best value (preselected), the cheapest and the fastest. The
 * chosen one is outlined; tapping another changes this shop's delivery and the total.
 */
function DeliveryChoices({
  cartId,
  group,
  currencyCode,
}: Readonly<{ cartId: string; group: CheckoutSellerGroup; currencyCode: string }>) {
  const theme = useTheme();
  const choose = useChooseDelivery(cartId);
  const sellerId = group.seller?.id;
  if (group.delivery_unavailable) {
    return (
      <View style={{ gap: theme.space.xs }} accessibilityLiveRegion="polite">
        <Text variant="label">Delivery unavailable</Text>
        <Text tone="secondary">{group.delivery_unavailable.reason}</Text>
      </View>
    );
  }
  if (!sellerId || !group.delivery_choices.length) {
    return (
      <View style={styles.spread}>
        <Text tone="secondary">Delivery</Text>
        <Text tone="secondary">Confirm the address to see rates</Text>
      </View>
    );
  }
  const now = new Date();
  // While a choice is being saved, it shows as chosen.
  const chosenId = (choose.isPending && choose.variables?.choiceId) || group.shipping?.choice_id;
  return (
    <View style={{ gap: theme.space.sm }} accessibilityRole="radiogroup" accessibilityLabel={`Delivery from ${group.seller?.name}`}>
      <Text variant="label">Delivery</Text>
      {group.delivery_choices.map((choice) => {
        const selected = choice.id === chosenId;
        const arrives = deliveryEstimate(choice.delivery_eta_time, now, choice.time_zone);
        return (
          <RadioOption
            key={choice.id}
            selected={selected}
            disabled={choose.isPending}
            onPress={() => {
              if (!selected) choose.mutate({ sellerId, choiceId: choice.id });
            }}>
            <View style={styles.spread}>
              <Text variant="label" style={styles.shrink}>
                {choice.tags.map((tag) => TAG_LABELS[tag]).join(' · ')}
              </Text>
              <Text variant="label">{formatMoney(choice.amount, currencyCode)}</Text>
            </View>
            <Text tone="secondary">
              {arrives} · {choice.courier_name}
            </Text>
          </RadioOption>
        );
      })}
      {choose.error ? (
        <Text style={{ color: theme.colors.danger }} accessibilityLiveRegion="polite">
          {`Couldn't change the delivery: ${choose.error.message}`}
        </Text>
      ) : null}
    </View>
  );
}

function Line({
  label,
  amount,
  currencyCode,
  strong = false,
}: Readonly<{ label: string; amount: number; currencyCode: string; strong?: boolean }>) {
  return (
    <View style={styles.spread}>
      <Text variant={strong ? 'label' : 'body'} tone={strong ? 'default' : 'secondary'}>
        {label}
      </Text>
      <Text variant={strong ? 'label' : 'body'}>{formatMoney(amount, currencyCode)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: buyerTheme.space.md },
  shrink: { flexShrink: 1 },
});
