import { useAuth } from '@clerk/expo';
import {
  addressFormValues,
  addressFromForm,
  deliveryEstimate,
  formatMoney,
  getAddressConfig,
  pinOf,
  type AddressFieldKey,
  type AddressFormValues,
  type DeliveryTag,
  PERISHABLE_DELIVERY_RULE,
  type PaymentReturn,
  type Pin,
} from '@oja/domain';
import { Button, buyerTheme, EmptyState, ErrorState, LoadingState, Text, useTheme } from '@oja/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  useCheckout,
  useChooseDelivery,
  usePrepareCheckout,
  useStartPayment,
  type Checkout,
  type CheckoutSellerGroup,
} from '@/api/checkout';
import { useCustomer } from '@/api/customer';
import { isAlreadyPaid } from '@/api/errors';
import { useCartSession } from '@/cart/cart-provider';
import { PerishableChip } from '@/components/perishable';
import { env } from '@/config/env';
import { useRegion } from '@/region/region-provider';

import { AddressEntry } from './address-entry';

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
  const { payment: returned } = useLocalSearchParams<{ payment?: PaymentLeft }>();
  const config = getAddressConfig(countryCode);
  // The form opens until the cart has an address; a cart quoted before it changed is quoted again below.
  const [editing, setEditing] = useState(!checkout.shipping_address);
  const [values, setValues] = useState<AddressFormValues>(() =>
    addressFormValues(checkout.shipping_address, countryCode, customer.data ?? undefined)
  );
  const [errors, setErrors] = useState<Partial<Record<AddressFieldKey, string>>>({});
  const [pin, setPin] = useState<Pin | null>(() => pinOf(checkout.shipping_address));
  // The buyer's profile may load after the form opens; their name fills whatever they left blank.
  const { first_name, last_name } = customer.data ?? {};
  useEffect(() => {
    setValues((current) => ({
      ...current,
      first_name: current.first_name || first_name || '',
      last_name: current.last_name || last_name || '',
    }));
  }, [first_name, last_name]);
  const prepare = usePrepareCheckout(cartId);
  const startPayment = useStartPayment(cartId);

  // A cart changed since its delivery was quoted (a shop added, a quantity changed) has a shop
  // without rates. Quote it again at the cart's address, once; if that fails, the form shows why.
  // A shop that can't deliver its order (perishables no courier brings in time) says why instead.
  const needsQuote =
    !editing &&
    !checkout.ready_to_pay &&
    !!checkout.shipping_address &&
    checkout.sellers.some((g) => !g.shipping && !g.delivery_unavailable);
  const requoted = useRef(false);
  useEffect(() => {
    if (!needsQuote) {
      requoted.current = false;
      return;
    }
    if (requoted.current || prepare.isPending) return;
    requoted.current = true;
    // An address saved before pins were required has none: the buyer places one.
    const result = pin ? addressFromForm(values, countryCode, pin) : null;
    if (result?.ok) prepare.mutate(result.address, { onError: () => setEditing(true) });
    else setEditing(true);
  }, [needsQuote, prepare, values, countryCode, pin]);

  const change = (key: AddressFieldKey, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors(({ [key]: _fixed, ...rest }) => rest);
  };
  const fillFromPlace = (found: AddressFormValues) => {
    setValues((current) => ({ ...current, ...found }));
    setErrors({});
  };
  const validate = () => {
    const result = addressFromForm(values, countryCode);
    if (!result.ok) setErrors(result.errors);
    return result.ok;
  };
  const saveAddress = (confirmed: Pin) => {
    const result = addressFromForm(values, countryCode, confirmed);
    if (result.ok) prepare.mutate(result.address, { onSuccess: () => setEditing(false) });
  };
  const pay = () =>
    startPayment.mutate(PAYMENT_RETURN_URL, {
      onSuccess: ({ authorization_url }) =>
        router.push({ pathname: '/checkout/pay', params: { cartId, url: authorization_url } }),
      // The last payment went through: wait for Paystack's confirmation rather than pay twice.
      onError: (error) => {
        if (isAlreadyPaid(error)) router.push({ pathname: '/checkout/confirmation', params: { cartId } });
      },
    });

  const notice = paymentNotice(startPayment.error, returned);

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={{ backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: theme.space.md, gap: theme.space.lg }}
        keyboardShouldPersistTaps="handled">
        <View style={{ gap: theme.space.md }}>
          <View style={styles.spread}>
            <Text variant="heading">Delivery address</Text>
            {editing ? null : <Button label="Change" variant="link" onPress={() => setEditing(true)} />}
          </View>
          {editing ? (
            <AddressEntry
              cartId={cartId}
              config={config}
              values={values}
              errors={errors}
              pin={pin}
              onChange={change}
              onPlace={fillFromPlace}
              onPin={setPin}
              validate={validate}
              onSave={saveAddress}
              saving={prepare.isPending}
              saveError={prepare.error}
            />
          ) : (
            <AddressSummary checkout={checkout} />
          )}
        </View>

        {editing ? null : (
          <>
            {checkout.sellers.map((group) => (
              <ShopSummary
                key={group.seller?.id ?? 'gone'}
                cartId={cartId}
                group={group}
                currencyCode={checkout.currency_code}
              />
            ))}
            <View style={{ gap: theme.space.sm }}>
              <Line label="Items" amount={checkout.item_subtotal} currencyCode={checkout.currency_code} />
              <Line label="Delivery" amount={checkout.shipping_total} currencyCode={checkout.currency_code} />
              <Line label="Total" amount={checkout.total} currencyCode={checkout.currency_code} strong />
              <Text variant="caption" tone="secondary">
                Prices include VAT. Each shop delivers its own items.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
      {editing ? null : (
        <View
          style={{
            padding: theme.space.md,
            gap: theme.space.sm,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.divider,
            backgroundColor: theme.colors.background,
          }}>
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
      )}
    </KeyboardAvoidingView>
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

function AddressSummary({ checkout }: Readonly<{ checkout: Checkout }>) {
  const theme = useTheme();
  const address = checkout.shipping_address;
  if (!address) return null;
  const landmark = address.metadata?.landmark;
  return (
    <View style={{ gap: theme.space.xs }}>
      <Text>
        {address.first_name} {address.last_name}
      </Text>
      <Text tone="secondary">
        {[address.address_1, address.address_2, address.city, address.province].filter(Boolean).join(', ')}
      </Text>
      {typeof landmark === 'string' && landmark ? <Text tone="secondary">{landmark}</Text> : null}
      <Text tone="secondary">{address.phone}</Text>
    </View>
  );
}

function ShopSummary({
  cartId,
  group,
  currencyCode,
}: Readonly<{ cartId: string; group: CheckoutSellerGroup; currencyCode: string }>) {
  const theme = useTheme();
  return (
    <View
      style={{
        gap: theme.space.sm,
        paddingTop: theme.space.md,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
      }}>
      <Text variant="heading">{group.seller?.name ?? 'No longer available'}</Text>
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
      {group.perishable && !group.delivery_unavailable ? (
        <Text variant="caption" tone="secondary">
          {PERISHABLE_DELIVERY_RULE}
        </Text>
      ) : null}
      <DeliveryChoices cartId={cartId} group={group} currencyCode={currencyCode} />
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
          <Pressable
            key={choice.id}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled: choose.isPending }}
            disabled={choose.isPending}
            onPress={() => {
              if (!selected) choose.mutate({ sellerId, choiceId: choice.id });
            }}
            style={{
              minHeight: theme.touchTarget,
              padding: theme.space.md,
              gap: theme.space.xs,
              borderRadius: theme.radius.md,
              borderColor: selected ? theme.colors.ink : theme.colors.divider,
              borderWidth: selected ? 2 : 1,
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
          </Pressable>
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
