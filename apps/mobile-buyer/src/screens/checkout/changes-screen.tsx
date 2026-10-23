import { formatMoney } from '@oja/domain';
import { ChangesSheet, InlineNote, useTheme, type ChangesSheetChange } from '@oja/ui';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { checkoutKeys, refusalMessage, useCheckout, useStartPayment } from '@/api/checkout';
import { isAlreadyPaid } from '@/api/errors';
import { useDeliveringToId } from '@/delivering-to/delivering-to-provider';

import { PAYMENT_RETURN_URL } from './review-step';

/**
 * "Some items changed" (#67): starting the payment found a price, the stock or a discount changed
 * since the buyer last saw the total, so nothing was charged. The sheet lists what changed and
 * the new total; the buyer pays it, or goes back to the cart.
 */
export function ChangesScreen() {
  const theme = useTheme();
  const { cartId } = useLocalSearchParams<{ cartId: string }>();
  const queryClient = useQueryClient();
  const checkout = useCheckout(cartId, { addressId: useDeliveringToId() });
  // Left by the Pay button that found the changes; a payment that changes again replaces it.
  const changes = useQuery<ChangesSheetChange[]>({ queryKey: checkoutKeys.changes(cartId), queryFn: skipToken }).data ?? [];
  const startPayment = useStartPayment(cartId);
  const total = checkout.data ? formatMoney(checkout.data.total, checkout.data.currency_code) : '';
  // A change can leave a shop to choose again (its delivery went): checkout shows it.
  const canPay = !!checkout.data?.ready_to_pay;

  const pay = () =>
    startPayment.mutate(PAYMENT_RETURN_URL, {
      onSuccess: (result) => {
        if (result.payment) {
          router.replace({ pathname: '/checkout/pay', params: { cartId, url: result.payment.authorization_url } });
          return;
        }
        queryClient.setQueryData(checkoutKeys.changes(cartId), [
          { key: 'again', label: 'Something else changed since. The total below is the new one.' },
        ]);
      },
      onError: (error) => {
        if (isAlreadyPaid(error)) router.replace({ pathname: '/checkout/confirmation', params: { cartId } });
      },
    });

  return (
    <View>
      {startPayment.error && !isAlreadyPaid(startPayment.error) ? (
        <View style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[4], backgroundColor: theme.colors.raised }}>
          <InlineNote>
            {refusalMessage(startPayment.error) ?? "Couldn't start the payment. You haven't been charged. Try again."}
          </InlineNote>
        </View>
      ) : null}
      <ChangesSheet
        title="Some items changed"
        message="Nothing has been charged. Since you added them:"
        changes={changes}
        totalLabel="New total"
        total={total}
        confirmLabel={canPay ? 'Update and pay' : 'Back to checkout'}
        onConfirm={canPay ? pay : () => router.back()}
        loading={startPayment.isPending}
        backLabel="Back to cart"
        // Pops the sheet and checkout together, as going back does, so a shop cart's items return to the cart.
        onBack={() => {
          router.dismiss(2);
          router.navigate('/cart');
        }}
      />
    </View>
  );
}
