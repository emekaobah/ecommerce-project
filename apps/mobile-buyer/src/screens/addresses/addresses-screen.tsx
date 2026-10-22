import { useAuth } from '@clerk/expo';
import { pinOf } from '@oja/domain';
import { Button, EmptyState, ErrorState, LoadingState, StatusChip, Text, useTheme } from '@oja/ui';
import { router } from 'expo-router';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import {
  useDeleteAddress,
  useMakeDefaultAddress,
  useSavedAddresses,
  type SavedAddressRecord,
} from '@/api/addresses';
import { AddressCard } from '@/components/address/address-card';

const addAddress = () => router.push('/addresses/edit');

/** Account → Addresses (#18): the buyer's saved delivery addresses, the default first. */
export function AddressesScreen() {
  const theme = useTheme();
  const { userId } = useAuth();
  const addresses = useSavedAddresses(userId);

  if (addresses.error && !addresses.data) {
    return (
      <ErrorState
        title="Couldn't load your addresses"
        message={addresses.error.message}
        onRetry={() => void addresses.refetch()}
      />
    );
  }
  if (!addresses.data) return <LoadingState />;
  if (addresses.data.length === 0) {
    return (
      <EmptyState
        title="No saved addresses"
        message="Save where you'd like deliveries, and checkout fills it in for you."
        action={{ label: 'Add an address', onPress: addAddress }}
      />
    );
  }
  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.bg }}
      contentContainerStyle={{ padding: theme.space[4], gap: theme.space[6] }}>
      {addresses.data.map((address) => (
        <SavedAddressRow key={address.id} address={address} />
      ))}
      <Button label="Add an address" variant="secondary" onPress={addAddress} />
    </ScrollView>
  );
}

function SavedAddressRow({ address }: Readonly<{ address: SavedAddressRecord }>) {
  const theme = useTheme();
  const makeDefault = useMakeDefaultAddress();
  const remove = useDeleteAddress();
  const unpinned = !pinOf(address);

  const confirmDelete = () =>
    Alert.alert('Delete this address?', address.address_1 ?? undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(address.id) },
    ]);

  const error = makeDefault.error ?? remove.error;
  return (
    <View
      style={{
        gap: theme.space[2],
        paddingBottom: theme.space[4],
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.line,
      }}>
      <AddressCard
        address={address}
        badge={<AddressBadge isDefault={address.is_default_shipping} unpinned={unpinned} />}
      />
      <View style={[styles.actions, { gap: theme.space[4] }]}>
        <Button
          label={unpinned ? 'Add a pin' : 'Edit'}
          variant="link"
          onPress={() => router.push({ pathname: '/addresses/edit', params: { id: address.id } })}
        />
        {address.is_default_shipping ? null : (
          <Button
            label="Make default"
            variant="link"
            loading={makeDefault.isPending}
            onPress={() => makeDefault.mutate(address.id)}
          />
        )}
        <Button label="Delete" variant="link" loading={remove.isPending} onPress={confirmDelete} />
      </View>
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {error.message}
        </Text>
      ) : null}
    </View>
  );
}

/** "Default" for the default address, else "Needs a pin" for one saved before pins were required. */
function AddressBadge({ isDefault, unpinned }: Readonly<{ isDefault: boolean; unpinned: boolean }>) {
  if (isDefault) return <StatusChip label="Default" tone="info" />;
  if (unpinned) return <StatusChip label="Needs a pin" tone="warning" />;
  return null;
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
});
