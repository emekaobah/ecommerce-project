import { formatMoney, paymentReturn, type PaymentReturn } from '@oja/domain';
import { ErrorState, Icon, LoadingState, PressableSurface, StatusChip, useTheme } from '@oja/ui';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { useCheckout } from '@/api/checkout';
import { useDeliveringToId } from '@/delivering-to/delivering-to-provider';

import { PAYMENT_RETURN_URL } from './review-step';

/**
 * Paystack's payment page in a WebView, inside an Oja frame that keeps the amount and the Secure
 * badge in view. Paystack sends the buyer to the checkout's return URL when they finish or
 * cancel; the WebView catches it instead of opening it, and the app moves on to wait for
 * Paystack's confirmation, or back to checkout to try again.
 */
export function PayScreen() {
  const theme = useTheme();
  const { cartId, url } = useLocalSearchParams<{ cartId: string; url: string }>();
  const checkout = useCheckout(cartId, { addressId: useDeliveringToId() }).data;
  const [loadError, setLoadError] = useState<Error | null>(null);
  // A new key reloads the page after "Try again".
  const [attempt, setAttempt] = useState(0);
  const done = useRef(false);

  // Closing the page ourselves says nothing about whether the buyer paid; Paystack's cancel does.
  const leave = (outcome: PaymentReturn['kind'] | 'closed') => {
    if (done.current) return;
    done.current = true;
    if (outcome === 'paid') {
      router.replace({ pathname: '/checkout/confirmation', params: { cartId } });
    } else {
      router.dismissTo({ pathname: '/checkout', params: { cartId, payment: outcome } });
    }
  };

  const header = (
    <Stack.Screen
      options={{
        title: checkout ? `Pay ${formatMoney(checkout.total, checkout.currency_code)}` : 'Pay',
        headerBackVisible: false,
        headerLeft: () => (
          <PressableSurface
            accessibilityRole="button"
            accessibilityLabel="Close the payment page"
            onPress={() => leave('closed')}
            style={[styles.centred, { minWidth: theme.hitArea, minHeight: theme.hitArea }]}>
            <Icon name="x" />
          </PressableSurface>
        ),
        headerRight: () => <StatusChip label="Secure" tone="success" icon="lock" />,
      }}
    />
  );

  if (loadError) {
    return (
      <>
        {header}
        <ErrorState
          icon="cloud-off"
          title="Couldn't open Paystack"
          body="The payment page didn't load. You haven't been charged."
          error={loadError}
          onRetry={() => {
            setLoadError(null);
            setAttempt((n) => n + 1);
          }}
          secondaryAction={{ label: 'Back to checkout', onPress: () => leave('closed') }}
        />
      </>
    );
  }

  return (
    <>
      {header}
      <View style={[styles.fill, { backgroundColor: theme.colors.bg }]}>
        <WebView
          key={attempt}
          source={{ uri: url }}
          style={[styles.fill, { backgroundColor: theme.colors.bg }]}
          startInLoadingState
          renderLoading={() => (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.bg }]}>
              <LoadingState label="Opening Paystack" />
            </View>
          )}
          onShouldStartLoadWithRequest={(request) => {
            const outcome = paymentReturn(request.url, PAYMENT_RETURN_URL);
            if (!outcome) return true;
            leave(outcome.kind);
            return false;
          }}
          onError={({ nativeEvent }) => setLoadError(new Error(nativeEvent.description || 'The page failed to load.'))}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centred: { alignItems: 'center', justifyContent: 'center' },
});
