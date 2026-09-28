import { useAuth } from '@clerk/expo';
import {
  addressFormValues,
  addressFromForm,
  formatMoney,
  getAddressConfig,
  type AddressFieldKey,
  type AddressFormValues,
  type PaymentReturn,
} from '@oja/domain';
import { Button, buyerTheme, EmptyState, ErrorState, LoadingState, Text, useTheme } from '@oja/ui';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import {
  useCheckout,
  usePrepareCheckout,
  useStartPayment,
  type Checkout,
  type CheckoutSellerGroup,
} from '@/api/checkout';
import { useCustomer } from '@/api/customer';
import { useCartSession } from '@/cart/cart-provider';
import { useRegion } from '@/region/region-provider';

import { AddressForm } from './address-form';

/** Where Paystack sends the buyer back to; the payment WebView catches it (see pay-screen). */
export const PAYMENT_RETURN_URL = Linking.createURL('checkout/paid');

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
  const { payment: returned } = useLocalSearchParams<{ payment?: PaymentReturn['kind'] }>();
  const config = getAddressConfig(countryCode);
  const [editing, setEditing] = useState(!checkout.ready_to_pay);
  const [values, setValues] = useState<AddressFormValues>(() =>
    addressFormValues(checkout.shipping_address, countryCode, customer.data ?? undefined)
  );
  const [errors, setErrors] = useState<Partial<Record<AddressFieldKey, string>>>({});
  const prepare = usePrepareCheckout(cartId);
  const startPayment = useStartPayment(cartId);

  const change = (key: AddressFieldKey, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors(({ [key]: _fixed, ...rest }) => rest);
  };
  const saveAddress = () => {
    const result = addressFromForm(values, countryCode);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    prepare.mutate(result.address, { onSuccess: () => setEditing(false) });
  };
  const pay = () =>
    startPayment.mutate(PAYMENT_RETURN_URL, {
      onSuccess: ({ authorization_url }) =>
        router.push({ pathname: '/checkout/pay', params: { cartId, url: authorization_url } }),
    });

  const notice = startPayment.error
    ? `Couldn't start the payment: ${startPayment.error.message}`
    : returned === 'cancelled'
      ? "Payment not completed. You haven't been charged. You can try again."
      : null;

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
            <>
              <AddressForm config={config} values={values} errors={errors} onChange={change} />
              {prepare.error ? (
                <Text style={{ color: theme.colors.danger }} accessibilityLiveRegion="polite">
                  {prepare.error.message}
                </Text>
              ) : null}
              <Button label="Use this address" onPress={saveAddress} loading={prepare.isPending} />
            </>
          ) : (
            <AddressSummary checkout={checkout} />
          )}
        </View>

        {editing ? null : (
          <>
            {checkout.sellers.map((group) => (
              <ShopSummary key={group.seller?.id ?? 'gone'} group={group} currencyCode={checkout.currency_code} />
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
            loading={startPayment.isPending}
          />
        </View>
      )}
    </KeyboardAvoidingView>
  );
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

function ShopSummary({ group, currencyCode }: Readonly<{ group: CheckoutSellerGroup; currencyCode: string }>) {
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
          <Text style={styles.shrink} numberOfLines={2}>
            {item.quantity} × {item.product_title ?? 'Item'}
          </Text>
          <Text>{formatMoney(item.subtotal, currencyCode)}</Text>
        </View>
      ))}
      <View style={styles.spread}>
        <Text tone="secondary">{group.shipping ? `Delivery · ${group.shipping.name}` : 'Delivery'}</Text>
        <Text tone="secondary">
          {group.shipping ? formatMoney(group.shipping.amount, currencyCode) : "Doesn't deliver here"}
        </Text>
      </View>
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
