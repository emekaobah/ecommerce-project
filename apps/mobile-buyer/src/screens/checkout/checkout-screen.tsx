import { useAuth } from '@clerk/expo';
import {
  addressStep,
  checkoutAddressOf,
  formatMoney,
  preselectedAddress,
  savedAddressFor,
  type AddressStep,
  type Pin,
  type PinnedDeliveryAddress,
} from '@oja/domain';
import { EmptyState, ErrorState, Icon, PressableSurface, Skeleton, StickyAction, Text, useTheme } from '@oja/ui';
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { useSaveAddress, useSavedAddresses, type SavedAddressRecord } from '@/api/addresses';
import { cartKeys, moveShopCartBack } from '@/api/cart';
import { useCheckout, usePrepareCheckout, type Checkout, type CheckoutContact, type CheckoutPreparation } from '@/api/checkout';
import { useCustomer } from '@/api/customer';
import { useAddressDraft } from '@/components/address/use-address-draft';
import { Card } from '@/components/cart/summary';
import { useCartSession, useIsAppCart } from '@/cart/cart-provider';
import { useDeliveringTo, useDeliveringToId } from '@/delivering-to/delivering-to-provider';
import { useRegion } from '@/region/region-provider';

import { ContactDetails, contactOf, DeliveryAddress } from './address-step';
import { DeliveryStep } from './delivery-step';
import { PayBar, ReviewStep, type PaymentLeft } from './review-step';

/** Checkout's three steps: the address with a confirmed pin, delivery per shop, then review and pay. */
type CheckoutStep = 1 | 2 | 3;

const STEP_TITLES: Record<CheckoutStep, string> = { 1: 'Delivery address', 2: 'Delivery', 3: 'Review and pay' };

/**
 * Checkout. `payment` is set when the buyer comes back from Paystack without paying, which
 * returns them to Review and pay. `cartId` is set to a shop cart when the buyer pays for one
 * shop's items on their own (#11); otherwise checkout is for the app's cart.
 */
export function CheckoutScreen() {
  const theme = useTheme();
  const session = useCartSession();
  const { cartId: shopCartId } = useLocalSearchParams<{ cartId?: string }>();
  const cartId = shopCartId ?? session.cartId;
  const { region } = useRegion();
  // Collection points are measured from the buyer's "Delivering to" address while nothing is delivered.
  const addressId = useDeliveringToId();
  const checkout = useCheckout(cartId, { addressId });
  useShopCartBackOnLeaving(cartId, addressId);

  const header = <Stack.Screen options={{ title: 'Checkout' }} />;
  if (cartId === null || checkout.data?.sellers.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon="bag"
          title="Nothing in your cart yet"
          body="Add something from a shop to check out."
          action={{ label: 'Browse shops near you', onPress: () => router.navigate('/') }}
        />
      </>
    );
  }
  if (checkout.error && !checkout.data) {
    return (
      <>
        {header}
        <ErrorState
          title="Couldn't load checkout"
          body="Check your connection and try again. You haven't been charged."
          error={checkout.error}
          onRetry={() => void checkout.refetch()}
        />
      </>
    );
  }
  const countryCode = region?.countries?.[0]?.iso_2;
  if (!cartId || !checkout.data || !countryCode || addressId === undefined) {
    return (
      <>
        {header}
        <View style={[styles.fill, { backgroundColor: theme.colors.bgGrouped, padding: theme.space[4], gap: theme.space[2] }]}>
          <View accessible accessibilityLabel="Loading checkout" style={{ gap: theme.space[2] }}>
            {[0, 1].map((card) => (
              <Card key={card}>
                <Skeleton width="50%" height={theme.type.body.fontSize} />
                <Skeleton height={theme.control.md} radius="md" />
                <Skeleton height={theme.control.md} radius="md" />
              </Card>
            ))}
          </View>
        </View>
      </>
    );
  }
  return <CheckoutForm cartId={cartId} checkout={checkout.data} countryCode={countryCode} addressId={addressId} />;
}

/**
 * A shop's items being paid for on their own (#11) are in a shop cart. Going back from its
 * checkout without paying moves them back to the app's cart, where the buyer left them; the API
 * refuses once the shop cart is paid.
 */
function useShopCartBackOnLeaving(cartId: string | null | undefined, addressId: string | null | undefined) {
  const navigation = useNavigation();
  const { cartId: appCartId } = useCartSession();
  const isAppCart = useIsAppCart(cartId);
  const orderGroupId = useCheckout(cartId, { addressId }).data?.order_group_id;
  const queryClient = useQueryClient();
  // Reads the latest cart and order on removal, so the listener below never needs replacing.
  const onRemoved = useEffectEvent((actionType: string) => {
    if (isAppCart || !cartId || !appCartId || orderGroupId) return;
    // Back, by the header or a swipe; after an order, checkout is dismissed with the rest.
    if (actionType !== 'GO_BACK' && actionType !== 'POP') return;
    void moveShopCartBack(appCartId, cartId).finally(() => queryClient.invalidateQueries({ queryKey: cartKeys.all }));
  });
  useEffect(() => {
    const unsubscribe = navigation.addListener('removed', (event) => onRemoved(event.data.action.type));
    // `removed` fires after the screen unmounts, so unsubscribing waits a microtask, as React
    // Navigation's `removed` event documents (expo-router/build/react-navigation/core/types.d.ts).
    // Only `navigation` re-runs this, and it is fixed for the screen, so one listener is ever live.
    return () => queueMicrotask(unsubscribe);
  }, [navigation]);
}

/**
 * The shops the buyer chose to collect from (#12), and whether a set of chosen shops means every
 * order is collected. A shop checkout switched to pickup itself (fresh items no courier brings in
 * time) isn't chosen: it is quoted for delivery again. It stays collected while nothing else is
 * delivered, and checkout then needs no address.
 */
function pickupChoice(checkout: Checkout) {
  const pickupShops = (switched: boolean) =>
    checkout.sellers.flatMap((g) => (g.seller && g.method === 'pickup' && !!g.pickup_note === switched ? [g.seller.id] : []));
  const chosenPickup = pickupShops(false);
  const switchedToPickup = new Set(pickupShops(true));
  const collectsAll = (ids: string[]) =>
    checkout.sellers.every((g) => g.seller && (ids.includes(g.seller.id) || switchedToPickup.has(g.seller.id)));
  return { chosenPickup, collectsAll };
}

/**
 * What checkout can be prepared with once the buyer changes which shops they collect from: their
 * details when every order is collected, else the cart's address. Null while it lacks that.
 */
function preparationFor(
  pickup: string[],
  allCollected: boolean,
  contact: CheckoutContact | null,
  cartAddress: PinnedDeliveryAddress | null,
): Omit<CheckoutPreparation, 'addressId'> | null {
  if (allCollected) return contact ? { contact, pickup } : null;
  return cartAddress ? { shippingAddress: cartAddress, pickup } : null;
}

function CheckoutForm({
  cartId,
  checkout,
  countryCode,
  addressId,
}: Readonly<{ cartId: string; checkout: Checkout; countryCode: string; addressId: string | null }>) {
  const theme = useTheme();
  const { userId } = useAuth();
  const customer = useCustomer(userId);
  const saved = useSavedAddresses(userId);
  // Checkout starts on the address Home and Search deliver to (#43); until that is known, the
  // saved addresses count as loading.
  const { address: deliveringTo } = useDeliveringTo();
  const startingFrom = deliveringTo === undefined ? undefined : saved.data;
  const picked = deliveringTo?.id ?? null;
  const prepareCheckout = usePrepareCheckout(cartId);
  const saveToAddressBook = useSaveAddress(countryCode);
  const money = (amount: number) => formatMoney(amount, checkout.currency_code);
  // Every preparation carries the "Delivering to" address, which collection points are measured from.
  const { mutate: prepareMutate } = prepareCheckout;
  const mutate = useCallback(
    (variables: Omit<CheckoutPreparation, 'addressId'>, options?: Parameters<typeof prepareMutate>[1]) =>
      prepareMutate({ ...variables, addressId }, options),
    [prepareMutate, addressId],
  );
  const prepare = { isPending: prepareCheckout.isPending, error: prepareCheckout.error, mutate };

  // Coming back from Paystack, or with a paid cart that wasn't placed, is Review and pay.
  const { payment: returned } = useLocalSearchParams<{ payment?: PaymentLeft }>();
  const [screenStep, setScreenStep] = useState<CheckoutStep>(returned || checkout.not_placed ? 3 : 1);

  /** The step the buyer moved the address to themselves (changing it); null follows the cart. */
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
      saved: startingFrom,
      savedFailed: !!saved.error,
      picked,
      countryCode,
    });

  const { chosenPickup, collectsAll } = pickupChoice(checkout);
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
          // A change of method that waited for the address goes back to the delivery step.
          if (pendingPickup) setScreenStep(2);
          setPendingPickup(null);
          onDelivered?.();
        },
      },
    );

  const collectFrom = (contact: CheckoutContact) =>
    prepare.mutate(
      { contact, pickup },
      {
        onSuccess: () => {
          if (pendingPickup) setScreenStep(2);
          setPendingPickup(null);
        },
      },
    );

  /** The buyer chooses how one shop's order reaches them. */
  const chooseMethod = (sellerId: string, method: 'delivery' | 'pickup') => {
    const next = method === 'pickup' ? [...chosenPickup, sellerId] : chosenPickup.filter((id) => id !== sellerId);
    const allCollected = collectsAll(next);
    const ready = preparationFor(next, allCollected, checkout.contact ?? contactOf(customer.data), cartAddress);
    if (ready) return prepare.mutate(ready);
    // Checkout needs the buyer's details, or an address, first: step 1 asks for them.
    setPendingPickup(next);
    if (!allCollected) setBuyerStep(hasSaved ? 'choosing' : 'entering');
    setScreenStep(1);
  };

  const chooseAddress = useCallback(() => setBuyerStep('choosing'), []);
  useAutomaticQuotes({
    step,
    saved: startingFrom,
    picked,
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
      setScreenStep(2);
      if (pinningSaved) saveToAddressBook.mutate({ id: pinningSaved.id, address });
      else if (saveNew && !savedAddressFor(saved.data ?? [], address, countryCode)) {
        saveToAddressBook.mutate({ address, makeDefault: !hasSaved });
      }
    });
  };
  const [editingContact, setEditingContact] = useState(false);
  const contact = checkout.contact ?? contactOf(customer.data);
  const editingDetails = editingContact || !checkout.contact || !!pendingPickup;
  // Step 1 is done once the cart has where its orders go: an address, or the buyer's details.
  const addressDone = everyCollected ? !editingDetails : step === 'chosen' && !pendingPickup;

  const back = () => (screenStep === 1 ? router.back() : setScreenStep((screenStep - 1) as CheckoutStep));

  const content = () => {
    if (screenStep === 1) {
      return everyCollected ? (
        <ContactDetails
          countryCode={countryCode}
          contact={contact}
          editing={editingDetails}
          saving={prepare.isPending}
          error={prepare.error}
          onEdit={() => setEditingContact(true)}
          onSave={(details) => {
            setEditingContact(false);
            collectFrom(details);
          }}
        />
      ) : (
        <DeliveryAddress
          cartId={cartId}
          checkout={checkout}
          countryCode={countryCode}
          step={step}
          onStep={setBuyerStep}
          hasCartAddress={!!cartAddress || checkout.ready_to_pay}
          saved={saved.data}
          saveError={saveToAddressBook.error}
          prepare={prepareCheckout}
          entry={draft.entry}
          savesNew={!pinningSaved}
          saveNew={saveNew}
          onSaveNew={setSaveNew}
          onChoose={(address) => deliverTo(address, () => setScreenStep(2))}
          onEnter={enterAddress}
          onEntered={deliverToEntered}
        />
      );
    }
    if (screenStep === 2) {
      return (
        <DeliveryStep cartId={cartId} checkout={checkout} choosingMethod={prepare.isPending} onChooseMethod={chooseMethod} money={money} />
      );
    }
    return <ReviewStep cartId={cartId} checkout={checkout} everyCollected={everyCollected} money={money} onStep={setScreenStep} />;
  };

  const action = () => {
    if (screenStep === 3) return <PayBar cartId={cartId} checkout={checkout} prepare={prepareCheckout} money={money} />;
    if (screenStep === 2) {
      // Every shop has its delivery chosen, or is collected: the totals are what the buyer pays.
      return (
        <StickyAction
          label="Continue"
          price={money(checkout.total)}
          onPress={() => setScreenStep(3)}
          disabled={!checkout.ready_to_pay}
          loading={prepare.isPending}
        />
      );
    }
    // The address step's own buttons save it; once saved, Continue moves on.
    return addressDone ? <StickyAction label="Continue" onPress={() => setScreenStep(2)} loading={prepare.isPending} /> : null;
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: STEP_TITLES[screenStep],
          headerBackVisible: false,
          headerLeft: () => (
            <PressableSurface
              accessibilityRole="button"
              accessibilityLabel={screenStep === 1 ? 'Back to cart' : `Back to ${STEP_TITLES[(screenStep - 1) as CheckoutStep]}`}
              onPress={back}
              style={[styles.centred, { minWidth: theme.hitArea, minHeight: theme.hitArea }]}>
              <Icon name="back" />
            </PressableSurface>
          ),
          headerRight: () => (
            <Text variant="meta" weight="bold" tone="muted">
              {`Step ${screenStep} of 3`}
            </Text>
          ),
        }}
      />
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <StepProgress step={screenStep} />
        <ScrollView
          style={{ backgroundColor: theme.colors.bgGrouped }}
          contentContainerStyle={{ padding: theme.space[4], paddingTop: theme.space[2], gap: theme.space[4] }}
          keyboardShouldPersistTaps="handled">
          {content()}
        </ScrollView>
        {action()}
      </KeyboardAvoidingView>
    </>
  );
}

/** Three bars under the header, filled as far as the buyer has got. */
function StepProgress({ step }: Readonly<{ step: CheckoutStep }>) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${step} of 3`}
      accessibilityValue={{ min: 1, max: 3, now: step }}
      style={[styles.progress, { gap: theme.space[1], paddingHorizontal: theme.space[4], paddingVertical: theme.space[2], backgroundColor: theme.colors.bgGrouped }]}>
      {([1, 2, 3] as const).map((bar) => (
        <View
          key={bar}
          style={[styles.fill, { height: theme.space[1], borderRadius: theme.radius.pill, backgroundColor: bar <= step ? theme.colors.primary : theme.colors.line }]}
        />
      ))}
    </View>
  );
}

/**
 * The quotes checkout asks for by itself. It starts with the address the buyer delivers to
 * (picked on Home or Search, else their default), once.
 * A cart changed since its delivery was quoted (a shop added, a quantity changed) has a shop
 * without rates, so it is quoted again at the cart's address, once. A shop that can't deliver
 * isn't missing rates. If either fails, the buyer chooses an address.
 */
function useAutomaticQuotes({
  step,
  saved,
  picked,
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
  /** The saved address picked to deliver to on Home or Search (#43). */
  picked: string | null;
  countryCode: string;
  cartAddress: PinnedDeliveryAddress | null;
  checkout: Checkout;
  /** The shops the buyer collects from, which aren't quoted. */
  pickup: string[];
  /** Every shop is collected: there is nothing to quote. */
  everyCollected: boolean;
  prepare: { isPending: boolean; mutate: (variables: Omit<CheckoutPreparation, 'addressId'>, options?: { onError?: () => void }) => void };
  onFailed: () => void;
}) {
  const { isPending, mutate } = prepare;
  const preselecting = useRef(false);
  useEffect(() => {
    const preselected = step === 'starting' && saved && !everyCollected ? preselectedAddress(saved, countryCode, picked) : null;
    if (!preselected || preselecting.current) return;
    preselecting.current = true;
    mutate({ shippingAddress: preselected.address, pickup }, { onError: onFailed });
  }, [step, saved, picked, countryCode, everyCollected, pickup, mutate, onFailed]);

  // A shop that can't deliver its order (perishables no courier brings in time, #69) says why
  // instead of being quoted again; a shop collected from needs no rates.
  const missingRates =
    !checkout.ready_to_pay && checkout.sellers.some((g) => g.method === 'delivery' && !g.shipping && !g.delivery_unavailable);
  const needsQuote = step === 'chosen' && !everyCollected && missingRates && !!cartAddress && !isPending;
  const requoted = useRef(false);
  useEffect(() => {
    if (!needsQuote) {
      if (step !== 'chosen') requoted.current = false;
      return;
    }
    if (requoted.current || !cartAddress) return;
    requoted.current = true;
    mutate({ shippingAddress: cartAddress, pickup }, { onError: onFailed });
  }, [needsQuote, step, cartAddress, pickup, mutate, onFailed]);
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centred: { alignItems: 'center', justifyContent: 'center' },
  progress: { flexDirection: 'row' },
});
