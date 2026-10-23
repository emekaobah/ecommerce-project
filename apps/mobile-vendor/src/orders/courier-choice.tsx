import { formatMoney } from '@oja/domain';
import { Button, InlineNote, RadioOption, Text, useTheme } from '@oja/ui';
import { useState } from 'react';
import { View } from 'react-native';

import { refusedWith } from '@/api/errors';
import { useBookLabel, type CourierOption, type CourierPick, type OrderFulfilment } from '@/api/orders';

/**
 * Book (or rebook) the order's courier label. Booking picks the buyer's courier, or the nearest
 * to it, unless it costs more than Oja tops up (#19); then the couriers quoting now are shown to
 * choose from instead (`CourierChoice`). `onBooked` runs once a label is booked.
 */
export function BookCourier({
  orderId,
  rebook = false,
  currency,
  onBooked,
}: Readonly<{ orderId: string; rebook?: boolean; currency: string; onBooked?: () => void }>) {
  const theme = useTheme();
  const mutation = useBookLabel(orderId);
  const [options, setOptions] = useState<CourierOption[] | null>(null);
  const book = (courier?: CourierPick) =>
    mutation.mutate(courier, {
      onSuccess: ({ courier_options, fulfilment }) => {
        setOptions(courier_options);
        if (fulfilment.state === 'label_booked') onBooked?.();
      },
      // The couriers quoting have changed, or one is booked without choosing: book again for a fresh quote.
      onError: () => setOptions(null),
    });
  return (
    <View style={{ gap: theme.space[2] }}>
      {options ? <CourierChoice options={options} currency={currency} booking={mutation.isPending} onChoose={book} /> : null}
      {mutation.error ? (
        <InlineNote>
          {refusedWith(mutation.error, [400, 409]) ?? "Couldn't book the courier. Check your connection and try again."}
        </InlineNote>
      ) : null}
      {options ? null : (
        <Button
          label={rebook ? 'Rebook courier label' : 'Book courier label'}
          size="main"
          trailingIcon="fwd"
          loading={mutation.isPending}
          onPress={() => book()}
        />
      )}
    </View>
  );
}

const arrives = (at: string) =>
  new Date(at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** What a courier costs against what the buyer paid for delivery, and who pays the difference. */
function priceNote({ difference, within_cap }: CourierOption, currency: string) {
  if (difference <= 0) return 'No more than the buyer paid';
  const more = `${formatMoney(difference, currency)} more than the buyer paid`;
  return within_cap ? `${more}. Oja pays it.` : `${more}. Needs Oja's approval.`;
}

/**
 * The confirm step when the courier booking would pick costs the platform more than the top-up
 * cap (#19): the couriers quoting now, cheapest first, for staff to choose one. One within the
 * cap is booked at once; one above it is sent to Oja's team to approve. The shop never pays.
 */
function CourierChoice({
  options,
  currency,
  booking,
  onChoose,
}: Readonly<{ options: CourierOption[]; currency: string; booking: boolean; onChoose: (courier: CourierPick) => void }>) {
  const theme = useTheme();
  const [chosen, setChosen] = useState<CourierOption | null>(null);
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="heading">Choose a courier</Text>
      <Text tone="muted">
        {"The buyer's courier can't take the parcel at the price they paid. Choose another; the buyer is told."}
      </Text>
      <View accessibilityRole="radiogroup" style={{ gap: theme.space[2] }}>
        {options.map((option) => (
          <RadioOption
            key={`${option.service_code}:${option.courier_id}`}
            selected={chosen === option}
            disabled={booking}
            onPress={() => setChosen(option)}
            trailing={
              <Text variant="strong" tabular>
                {formatMoney(option.amount, currency)}
              </Text>
            }>
            <Text weight="bold">{option.courier_name}</Text>
            <Text variant="meta" tone="muted">{`Arrives ${arrives(option.delivery_eta_time)}`}</Text>
            <Text variant="meta" tone={option.within_cap ? 'muted' : 'ember'}>
              {priceNote(option, currency)}
            </Text>
          </RadioOption>
        ))}
      </View>
      <Button
        size="main"
        label={chosen && !chosen.within_cap ? `Ask Oja to approve ${chosen.courier_name}` : `Book ${chosen?.courier_name ?? 'courier'}`}
        disabled={!chosen}
        loading={booking}
        onPress={() => chosen && onChoose({ courier_id: chosen.courier_id, service_code: chosen.service_code })}
      />
    </View>
  );
}

/** While a courier staff chose waits for Oja's team to approve it (#19): which, and at what price. Nothing otherwise. */
export function ApprovalNote({ fulfilment, currency }: Readonly<{ fulfilment: Pick<OrderFulfilment, 'courier_approval'>; currency: string }>) {
  if (!fulfilment.courier_approval) return null;
  const { courier_name, amount } = fulfilment.courier_approval;
  return (
    <Text tone="muted">
      {`Waiting for Oja to approve ${courier_name} at ${formatMoney(amount, currency)}. It is booked once approved; you can choose another meanwhile.`}
    </Text>
  );
}
