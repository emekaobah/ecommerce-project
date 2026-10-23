import {
  addressLines,
  deliveryDay,
  notPlacedChangeMessage,
  notPlacedMessage,
  paymentRefusal,
  priceChangeMessage,
  type NotPlacedChange,
  type PaymentReturn,
  type PriceChange,
} from '@oja/domain';
import { Icon, InlineNote, PressableSurface, StickyAction, Text, useTheme, type ChangesSheetChange, type IconName } from '@oja/ui';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  checkoutKeys,
  useStartPayment,
  type Checkout,
  type CheckoutSellerGroup,
  type usePrepareCheckout,
} from '@/api/checkout';
import { isAlreadyPaid, useFailureMessage } from '@/api/errors';
import { SumRow } from '@/components/cart/summary';
import { env } from '@/config/env';

import { PromoCodes } from './promo-codes';

/**
 * Where Paystack sends the buyer back to. Paystack only redirects to an http(s) URL, so this is
 * a page on the API that the payment WebView catches and never loads (see pay-screen).
 */
export const PAYMENT_RETURN_URL = `${env.apiUrl}/paystack/return`;

/** How the buyer came back from Paystack without paying: Paystack's cancel, or closing its page. */
export type PaymentLeft = Extract<PaymentReturn['kind'], 'cancelled'> | 'closed';

/** Step 3: everything chosen, each a tap from changing, then the promo code and the totals. */
export function ReviewStep({
  cartId,
  checkout,
  everyCollected,
  money,
  onStep,
}: Readonly<{
  cartId: string;
  checkout: Checkout;
  everyCollected: boolean;
  money: (amount: number) => string;
  onStep: (step: 1 | 2) => void;
}>) {
  const theme = useTheme();
  const now = new Date();
  const address = checkout.shipping_address ? addressLines(checkout.shipping_address) : null;
  const contact = checkout.contact;
  const [first, ...rest] = checkout.sellers.map((group) => `${group.seller?.name ?? 'Shop'} · ${howItComes(group, now)}`);
  return (
    <View style={{ gap: theme.space[4] }}>
      <NotPlaced checkout={checkout} money={money} />
      <View>
        {everyCollected || !address ? (
          <ReviewRow icon="user" title={contact ? `${contact.first_name} ${contact.last_name}` : 'Your details'} detail={contact?.phone} onChange={() => onStep(1)} />
        ) : (
          <ReviewRow icon="pin" title={address.place} detail={address.landmark} onChange={() => onStep(1)} />
        )}
        <ReviewRow icon="truck" title={first ?? 'Delivery'} details={rest} onChange={() => onStep(2)} />
      </View>
      <PromoCodes cartId={cartId} checkout={checkout} />
      <View style={{ gap: theme.space[2] }}>
        <SumRow label="Items" value={money(checkout.item_subtotal)} />
        <SumRow label="Delivery" value={money(checkout.shipping_total)} />
        {checkout.promotions.map((promotion) => (
          <SumRow key={promotion.code} label={`Promo ${promotion.code}`} value={`−${money(promotion.amount)}`} tone="leaf" />
        ))}
        <SumRow label="Total" value={money(checkout.total)} total />
      </View>
    </View>
  );
}

/** "Thu 23 Oct" for a courier, "Pickup" for a shop the buyer collects from. */
function howItComes(group: CheckoutSellerGroup, now: Date): string {
  if (group.method === 'pickup') return 'Pickup';
  const choice = group.delivery_choices.find((c) => c.id === group.shipping?.choice_id);
  return choice ? deliveryDay(choice.delivery_eta_time, now, choice.time_zone) : 'Delivery to choose';
}

/** A chosen thing with its icon, and Change, which goes back to the step it was chosen on. */
function ReviewRow({
  icon,
  title,
  detail,
  details = detail ? [detail] : [],
  onChange,
}: Readonly<{ icon: IconName; title: string; detail?: string | null; details?: string[]; onChange: () => void }>) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { gap: theme.space[3], paddingVertical: theme.space[3] }]}>
      <Icon name={icon} />
      <View style={styles.fill}>
        <Text weight="bold">{title}</Text>
        {details.map((line) => (
          <Text key={line} variant="meta" tone="muted">
            {line}
          </Text>
        ))}
      </View>
      <PressableSurface
        accessibilityRole="button"
        accessibilityLabel={`Change ${title}`}
        onPress={onChange}
        style={[styles.change, { minHeight: theme.hitArea, minWidth: theme.hitArea }]}>
        <Text variant="meta" tone="muted">
          Change
        </Text>
      </PressableSurface>
    </View>
  );
}

/**
 * The buyer paid, but the cart failed to become orders (#38): the refund first, then what changed
 * in the cart, which they can now pay for again.
 */
function NotPlaced({ checkout, money }: Readonly<{ checkout: Checkout; money: (amount: number) => string }>) {
  const theme = useTheme();
  const notPlaced = checkout.not_placed;
  if (!notPlaced) return null;
  return (
    <View style={{ gap: theme.space[2] }}>
      <InlineNote>
        <Text variant="meta" weight="bold" tone="ember">
          {"Your order wasn't placed. "}
        </Text>
        {`${notPlacedMessage(notPlaced, checkout.currency_code)} A refund can take a few days to reach your card.`}
      </InlineNote>
      <View style={[styles.note, { gap: theme.space[2], padding: theme.space[2], borderRadius: theme.radius.md, backgroundColor: theme.colors.tile }]}>
        <Icon name="info" use="chip" color={theme.colors.muted} />
        <Text variant="meta" style={styles.fill}>
          {[...notPlaced.changes.map(notPlacedChangeMessage), `The total below, ${money(checkout.total)}, is what you'll pay if you order again.`].join(' ')}
        </Text>
      </View>
    </View>
  );
}

type Repricing = { data?: { price_changes: PriceChange[] }; submittedAt: number };

/**
 * What the buyer's latest address save repriced, until they start a payment: one that doesn't
 * start lists its own changes on the changes sheet.
 */
function addressPriceChanges(prepare: Repricing, startPayment: Repricing): PriceChange[] {
  if (!prepare.data || (startPayment.data && startPayment.submittedAt > prepare.submittedAt)) return [];
  return prepare.data.price_changes;
}

/** What to tell the buyer above the Pay button: why starting a payment failed, or how they left Paystack. */
function paymentNotice(failure: string | null, returned: PaymentLeft | undefined): ReactNode {
  if (failure) return failure;
  if (returned === 'cancelled') {
    return (
      <>
        <Text variant="meta" weight="bold" tone="ember">
          {'Payment not completed. '}
        </Text>
        {"You haven't been charged. You can try again."}
      </>
    );
  }
  if (returned === 'closed') return 'If you finished paying, your order appears in Orders once Paystack confirms it.';
  return null;
}

/** The lines of the cart, by name, for the changes sheet's photos. */
function photoFor(checkout: Checkout, match: (item: CheckoutSellerGroup['items'][number]) => boolean): string | null {
  return checkout.sellers.flatMap((g) => g.items).find(match)?.thumbnail ?? null;
}

/**
 * What changed when a payment didn't start, as the changes sheet lists it: in the words "Order
 * not placed" uses, each with its photo from the checkout the buyer was looking at.
 */
function changesOf(
  before: Checkout,
  result: { price_changes: PriceChange[]; stock_changes: NotPlacedChange[]; discount_changed?: boolean },
): ChangesSheetChange[] {
  const stock = result.stock_changes.map((change, index) => ({
    key: `stock-${index}`,
    label: notPlacedChangeMessage(change),
    imageUrl:
      'product_title' in change
        ? photoFor(before, (item) => item.product_title === change.product_title && item.variant_title === change.variant_title)
        : undefined,
  }));
  const prices = result.price_changes.map((change) => ({
    key: `price-${change.line_item_id}`,
    label: priceChangeMessage(change, before.currency_code),
    imageUrl: photoFor(before, (item) => item.id === change.line_item_id),
  }));
  const discount = result.discount_changed
    ? [{ key: 'discount', label: 'Your discounts changed: a code ended, was used up or no longer applies.' }]
    : [];
  return [...stock, ...prices, ...discount];
}

/** The Pay button, with what happened to the last payment just above it. */
export function PayBar({
  cartId,
  checkout,
  prepare,
  money,
}: Readonly<{
  cartId: string;
  checkout: Checkout;
  prepare: ReturnType<typeof usePrepareCheckout>;
  money: (amount: number) => string;
}>) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { payment: returned } = useLocalSearchParams<{ payment?: PaymentLeft }>();
  const startPayment = useStartPayment(cartId);
  const repriced = addressPriceChanges(prepare, startPayment);
  const pay = () =>
    startPayment.mutate(PAYMENT_RETURN_URL, {
      onSuccess: (result) => {
        if (result.payment) {
          router.push({ pathname: '/checkout/pay', params: { cartId, url: result.payment.authorization_url } });
          return;
        }
        // No payment: a price, the stock or a discount changed. The sheet lists what, with the new total.
        queryClient.setQueryData(checkoutKeys.changes(cartId), changesOf(checkout, result));
        router.push({ pathname: '/checkout/changes', params: { cartId } });
      },
      // The last payment went through: wait for Paystack's confirmation rather than pay twice.
      onError: (error) => {
        if (isAlreadyPaid(error)) router.push({ pathname: '/checkout/confirmation', params: { cartId } });
      },
    });
  const failure = useFailureMessage(
    startPayment.error && !isAlreadyPaid(startPayment.error) ? startPayment.error : null,
    "Couldn't start the payment. You haven't been charged. Try again.",
    // The API's 400s here carry no code: the checkout shows which shop holds it up.
    { 400: paymentRefusal(checkout) ?? "Something in your order needs a change before paying. You haven't been charged." }
  );
  const notice = paymentNotice(failure, returned);

  return (
    <View style={{ backgroundColor: theme.colors.bg }}>
      {repriced.length || notice ? (
        <View style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[2], gap: theme.space[2] }}>
          {repriced.length ? (
            <InlineNote>
              <Text variant="meta" weight="bold" tone="ember">
                {'Some prices changed since you added these items. '}
              </Text>
              {repriced.map((change) => priceChangeMessage(change, checkout.currency_code)).join(' ')}
            </InlineNote>
          ) : null}
          {notice ? <InlineNote>{notice}</InlineNote> : null}
        </View>
      ) : null}
      <StickyAction
        label="Pay with Paystack"
        price={money(checkout.total)}
        onPress={pay}
        loading={startPayment.isPending || prepare.isPending}
        disabled={!checkout.ready_to_pay}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  note: { flexDirection: 'row', alignItems: 'flex-start' },
  change: { alignItems: 'flex-end', justifyContent: 'center' },
});
