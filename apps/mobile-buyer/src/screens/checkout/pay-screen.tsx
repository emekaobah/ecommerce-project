import { paymentReturn, type PaymentReturn } from '@oja/domain';
import { Button, ErrorState, LoadingState, useTheme } from '@oja/ui';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

import { PAYMENT_RETURN_URL } from './checkout-screen';

/**
 * Paystack's payment page in a WebView. Paystack sends the buyer to the checkout's return URL
 * when they finish or cancel; the WebView catches it instead of opening it, and the app moves on
 * to wait for Paystack's confirmation, or back to checkout to try again.
 */
export function PayScreen() {
  const theme = useTheme();
  const { cartId, url } = useLocalSearchParams<{ cartId: string; url: string }>();
  const [loadError, setLoadError] = useState<Error | null>(null);
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
    <>
      <Stack.Screen options={{ title: 'Pay with Paystack', headerBackVisible: false }} />
      <Stack.Toolbar placement="left" asChild>
        <CancelButton onCancel={() => leave('closed')} />
      </Stack.Toolbar>
    </>
  );

  if (loadError) {
    return (
      <>
        {header}
        <ErrorState
          title="Couldn't open Paystack"
          body="The payment page didn't load. You haven't been charged."
          error={loadError}
          onRetry={() => setLoadError(null)}
        />
      </>
    );
  }

  return (
    <>
      {header}
      <WebView
        source={{ uri: url }}
        style={[styles.fill, { backgroundColor: theme.colors.bg }]}
        startInLoadingState
        renderLoading={() => <LoadingState label="Opening Paystack" />}
        onShouldStartLoadWithRequest={(request) => {
          const outcome = paymentReturn(request.url, PAYMENT_RETURN_URL);
          if (!outcome) return true;
          leave(outcome.kind);
          return false;
        }}
        onError={({ nativeEvent }) => setLoadError(new Error(nativeEvent.description || 'The page failed to load.'))}
      />
    </>
  );
}

/** The header's Cancel button, which closes Paystack's page. */
function CancelButton({ onCancel }: Readonly<{ onCancel: () => void }>) {
  return <Button label="Cancel" variant="link" onPress={onCancel} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
