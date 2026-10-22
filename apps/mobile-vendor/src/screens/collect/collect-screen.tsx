import { isPickupCodeFormat, PICKUP_CODE_LENGTH } from '@oja/domain';
import { Button, ErrorState, ListRow, LoadingState, Text, useTheme } from '@oja/ui';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { useCollectOrder, useOrder, type Order } from '@/api/orders';
import { Field } from '@/components/field';
import { lineLabel } from '@/orders/items';

/**
 * Handing a pickup order over at the counter (#12): scan the QR code in the buyer's app or type
 * its code, then check the order against the buyer's name and items, enter who is collecting it,
 * and hand it all over. The server checks the code; whoever holds it may collect.
 */
export function CollectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrder(id);
  const [code, setCode] = useState<string | null>(null);

  const content = () => {
    if (order.error && !order.data) {
      return <ErrorState title="Couldn't load the order" message={order.error.message} onRetry={() => void order.refetch()} />;
    }
    if (!order.data) return <LoadingState />;
    if (!code) return <CodeEntry onCode={setCode} />;
    return <Confirm order={order.data} code={code} onWrongCode={() => setCode(null)} />;
  };

  return (
    <>
      <Stack.Screen options={{ title: order.data ? `Hand over #${order.data.display_id}` : 'Hand over' }} />
      {content()}
    </>
  );
}

/** The code, scanned from the buyer's QR code or typed; the camera is optional. */
function CodeEntry({ onCode }: Readonly<{ onCode: (code: string) => void }>) {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onScanned = ({ data }: BarcodeScanningResult) => {
    const scanned = data.trim();
    if (isPickupCodeFormat(scanned)) onCode(scanned);
    else setError("That QR code isn't a pickup code.");
  };
  const submit = () => {
    const entered = typed.trim();
    if (isPickupCodeFormat(entered)) onCode(entered);
    else setError(`Enter the ${PICKUP_CODE_LENGTH}-digit code from the buyer's app.`);
  };

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {permission?.granted ? (
        <CameraView
          style={styles.fill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onScanned}
        />
      ) : null}
      <View style={{ padding: theme.space[4], gap: theme.space[2], backgroundColor: theme.colors.bg }}>
        <Text tone="muted">
          {permission?.granted
            ? "Scan the QR code in the buyer's app, or type its code."
            : "Type the code from the buyer's app, or allow the camera to scan its QR code."}
        </Text>
        {permission && !permission.granted && permission.canAskAgain ? (
          <Button label="Allow camera" variant="secondary" onPress={() => void requestPermission()} />
        ) : null}
        <Field
          label="Pickup code"
          value={typed}
          onChangeText={(next) => {
            setTyped(next);
            setError(null);
          }}
          keyboardType="number-pad"
          maxLength={PICKUP_CODE_LENGTH}
          error={error ?? undefined}
          onSubmitEditing={submit}
        />
        <Button label="Continue" onPress={submit} />
      </View>
    </KeyboardAvoidingView>
  );
}

/** Who the order is for and what's in it, the collector's name, then the handover. */
function Confirm({ order, code, onWrongCode }: Readonly<{ order: Order; code: string; onWrongCode: () => void }>) {
  const theme = useTheme();
  const router = useRouter();
  const collect = useCollectOrder(order.id);
  const [collectedBy, setCollectedBy] = useState('');
  const buyer = [order.billing_address?.first_name, order.billing_address?.last_name].filter(Boolean).join(' ');

  const handOver = () =>
    collect.mutate(
      { code, collectedBy: collectedBy.trim() },
      { onSuccess: () => router.dismissTo({ pathname: '/orders/[id]', params: { id: order.id } }) },
    );

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: theme.space[4], gap: theme.space[6] }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: theme.space[1] }}>
          <Text variant="strong">Ordered by</Text>
          <Text variant="titleNamed">{buyer || 'The buyer'}</Text>
        </View>
        <View>
          {(order.items ?? []).map((item) => (
            <ListRow key={item.id} title={lineLabel(item)} />
          ))}
        </View>
        <Text tone="muted">Hand over everything on the order. Whoever has the code can collect it.</Text>
        <Field
          label="Who is collecting?"
          placeholder="Their name"
          value={collectedBy}
          onChangeText={setCollectedBy}
          autoCapitalize="words"
          autoCorrect={false}
        />
        {collect.error ? <Text tone="danger">{collect.error.message}</Text> : null}
        <Button label="Hand over order" loading={collect.isPending} disabled={!collectedBy.trim()} onPress={handOver} />
        <Button label="Enter the code again" variant="secondary" disabled={collect.isPending} onPress={onWrongCode} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
