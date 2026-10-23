import { deliveryEstimate, distanceLabel, PERISHABLE_HOLD_OPEN_DAYS, PICKUP_HOLD_OPEN_DAYS, type DeliveryTag } from '@oja/domain';
import { Group, GroupList, InlineNote, RadioOption, ShopMark, Text, useTheme } from '@oja/ui';
import { StyleSheet, View } from 'react-native';

import { refusalMessage, useChooseDelivery, type Checkout, type CheckoutSellerGroup } from '@/api/checkout';
import { SumRow } from '@/components/cart/summary';
import { PerishableRule } from '@/components/perishable';
import { PickupDetails } from '@/components/pickup';

const TAG_LABELS: Record<DeliveryTag, string> = { best_value: 'Best value', cheapest: 'Cheapest', fastest: 'Fastest' };

/** Step 2: one list per shop, each option with its date, its courier or pickup place, and its price. */
export function DeliveryStep({
  cartId,
  checkout,
  choosingMethod,
  onChooseMethod,
  money,
}: Readonly<{
  cartId: string;
  checkout: Checkout;
  choosingMethod: boolean;
  onChooseMethod: (sellerId: string, method: 'delivery' | 'pickup') => void;
  money: (amount: number) => string;
}>) {
  const delivered = checkout.sellers.filter((group) => group.method === 'delivery').length;
  return (
    <GroupList>
      {checkout.sellers.map((group) => (
        <ShopDelivery
          key={group.seller?.id ?? 'gone'}
          cartId={cartId}
          group={group}
          money={money}
          choosingMethod={choosingMethod}
          onChooseMethod={onChooseMethod}
        />
      ))}
      <Group>
        <SumRow label={deliveryLabel(delivered)} value={money(checkout.shipping_total)} />
      </Group>
    </GroupList>
  );
}

/** "Delivery, 2 shops": how many shops deliver; "Delivery" when none do. */
function deliveryLabel(shops: number): string {
  if (!shops) return 'Delivery';
  return `Delivery, ${shops} ${shops === 1 ? 'shop' : 'shops'}`;
}

const itemsWord = (group: CheckoutSellerGroup) => {
  const count = group.items.reduce((sum, item) => sum + item.quantity, 0);
  return `${count} ${count === 1 ? 'item' : 'items'}`;
};

/** "Surulere · 1 km · collect within 5 open days"; fresh items are held one open day. */
function pickupLine(group: CheckoutSellerGroup & { pickup: NonNullable<CheckoutSellerGroup['pickup']> }): string {
  const { pickup } = group;
  const distance = pickup.distance_km === null ? null : distanceLabel(pickup.distance_km);
  const days = group.perishable ? PERISHABLE_HOLD_OPEN_DAYS : PICKUP_HOLD_OPEN_DAYS;
  const hold = days === 1 ? 'collect within 1 open day' : `collect within ${days} open days`;
  return [pickup.address.city, distance, hold].filter(Boolean).join(' · ');
}

/**
 * One shop's options: its courier rates (best value preselected), then pickup when the shop has
 * a collection point. Choosing pickup shows where and the hold; choosing a courier back quotes it.
 */
function ShopDelivery({
  cartId,
  group,
  money,
  choosingMethod,
  onChooseMethod,
}: Readonly<{
  cartId: string;
  group: CheckoutSellerGroup;
  money: (amount: number) => string;
  choosingMethod: boolean;
  onChooseMethod: (sellerId: string, method: 'delivery' | 'pickup') => void;
}>) {
  const theme = useTheme();
  const choose = useChooseDelivery(cartId);
  const { seller } = group;
  const sellerId = seller?.id;
  const busy = choose.isPending || choosingMethod;
  const now = new Date();
  // While a choice is being saved, it shows as chosen.
  const chosenId = (choose.isPending && choose.variables?.choiceId) || group.shipping?.choice_id;
  const collecting = group.method === 'pickup';

  return (
    <Group gap={2}>
      <ShopHeading group={group} />
      <ShopNotes group={group} />

      <View style={{ gap: theme.space[2] }} accessibilityRole="radiogroup" accessibilityLabel={`How to get ${seller?.name ?? 'these'} items`}>
        {sellerId && !collecting
          ? group.delivery_choices.map((choice) => (
              <CourierOption
                key={choice.id}
                choice={choice}
                now={now}
                selected={choice.id === chosenId}
                disabled={busy}
                money={money}
                onChoose={() => choose.mutate({ sellerId, choiceId: choice.id })}
              />
            ))
          : null}
        {sellerId && !collecting && !group.delivery_choices.length && !group.delivery_unavailable ? (
          <Text tone="muted">Confirm your address to see delivery options.</Text>
        ) : null}
        {/* Collected: delivery is quoted again only once the buyer picks it. */}
        {sellerId && collecting && !group.pickup_note ? (
          <RadioOption selected={false} disabled={busy} onPress={() => onChooseMethod(sellerId, 'delivery')}>
            <Text weight="bold">Delivery</Text>
            <Text variant="meta" tone="muted">
              Couriers and dates are shown once you choose it
            </Text>
          </RadioOption>
        ) : null}
        {sellerId && group.pickup ? (
          <RadioOption
            selected={collecting}
            disabled={busy}
            onPress={() => {
              if (!collecting) onChooseMethod(sellerId, 'pickup');
            }}
            trailing={<Text weight="extrabold">Free</Text>}>
            <Text weight="bold">Pick up at the shop</Text>
            <Text variant="meta" tone="muted">
              {pickupLine({ ...group, pickup: group.pickup })}
            </Text>
          </RadioOption>
        ) : null}
      </View>
      {collecting && group.pickup ? (
        <View style={{ gap: theme.space[2], paddingTop: theme.space[1] }}>
          <Text variant="meta">{group.pickup.hold_notice}</Text>
          <PickupDetails place={group.pickup} />
        </View>
      ) : null}
      {choose.error ? (
        <InlineNote>{refusalMessage(choose.error) ?? "Couldn't change the delivery. Check your connection and try again."}</InlineNote>
      ) : null}
    </Group>
  );
}

/** The shop's mark and name, when a closed shop will prepare the order, and how many items. */
function ShopHeading({ group }: Readonly<{ group: CheckoutSellerGroup }>) {
  const theme = useTheme();
  const { seller, shop_status: status } = group;
  const preparedLater = status?.state === 'closed' && status.orderable ? `${status.label} · prepared then` : null;
  return (
    <View style={[styles.row, { gap: theme.space[2] }]}>
      {seller ? <ShopMark name={seller.name} logoUrl={seller.logo} size="sm" /> : null}
      <View style={styles.fill}>
        <Text weight="bold">{seller?.name ?? 'No longer available'}</Text>
        {preparedLater ? (
          <Text variant="meta" tone="muted">
            {preparedLater}
          </Text>
        ) : null}
      </View>
      <Text variant="meta" tone="muted">
        {itemsWord(group)}
      </Text>
    </View>
  );
}

/** What stands in the way of the shop's options: not taking orders, fresh items, no delivery, no pickup. */
function ShopNotes({ group }: Readonly<{ group: CheckoutSellerGroup }>) {
  const { seller, shop_status: status } = group;
  return (
    <>
      {status && !status.orderable ? (
        <InlineNote>{`${status.label}. Remove ${seller?.name ?? 'its'} items from your cart to pay for the rest.`}</InlineNote>
      ) : null}
      {group.perishable && !group.delivery_unavailable ? <PerishableRule /> : null}
      {group.delivery_unavailable ? <InlineNote>{group.delivery_unavailable.reason}</InlineNote> : null}
      {group.pickup_note ? <InlineNote>{group.pickup_note}</InlineNote> : null}
    </>
  );
}

/** A courier's rate: its tag and date, the courier, and its price; choosing it again does nothing. */
function CourierOption({
  choice,
  now,
  selected,
  disabled,
  money,
  onChoose,
}: Readonly<{
  choice: CheckoutSellerGroup['delivery_choices'][number];
  now: Date;
  selected: boolean;
  disabled: boolean;
  money: (amount: number) => string;
  onChoose: () => void;
}>) {
  const tags = choice.tags.map((tag) => TAG_LABELS[tag]);
  const arrives = deliveryEstimate(choice.delivery_eta_time, now, choice.time_zone);
  return (
    <RadioOption
      selected={selected}
      disabled={disabled}
      onPress={() => {
        if (!selected) onChoose();
      }}
      trailing={
        <Text weight="extrabold" tabular>
          {money(choice.amount)}
        </Text>
      }>
      {/* "Best value · Thu 23 Oct"; a rate that is also the cheapest or fastest says so beside its courier. */}
      <Text weight="bold">{[tags[0], arrives].filter(Boolean).join(' · ')}</Text>
      <Text variant="meta" tone="muted">
        {[choice.courier_name, ...tags.slice(1)].join(' · ')}
      </Text>
    </RadioOption>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
});
