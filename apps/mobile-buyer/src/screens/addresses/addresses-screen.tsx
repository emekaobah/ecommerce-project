import { useAuth } from '@clerk/expo';
import { addressLines, pinOf } from '@oja/domain';
import {
  Button,
  ConfirmSheet,
  EmptyState,
  ErrorState,
  Icon,
  PressableSurface,
  Skeleton,
  StatusChip,
  Text,
  useTheme,
  useToast,
} from '@oja/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  useDeleteAddress,
  useMakeDefaultAddress,
  useSavedAddresses,
  type SavedAddressRecord,
} from '@/api/addresses';
import { SheetModal } from '@/components/sheet-modal';

const addAddress = () => router.push('/addresses/edit');
const editAddress = (address: SavedAddressRecord) =>
  router.push({ pathname: '/addresses/edit', params: { id: address.id } });

/** The street an address is known by ("14 Bode Thomas St"), and where it is ("Surulere, Lagos"). */
function streetAndArea(address: SavedAddressRecord) {
  const street = [address.address_1, address.address_2].map((part) => part?.trim()).filter(Boolean).join(', ');
  const area = [address.city, address.province].map((part) => part?.trim()).filter(Boolean).join(', ');
  return { street: street || area, area };
}

/** Account → Addresses (#18): the buyer's saved delivery addresses, the default first. */
export function AddressesScreen() {
  const theme = useTheme();
  const { userId } = useAuth();
  const addresses = useSavedAddresses(userId);
  const [deleting, setDeleting] = useState<SavedAddressRecord | null>(null);

  if (addresses.error && !addresses.data) {
    return (
      <ErrorState
        title="Couldn't load your addresses"
        body="Your addresses are safe. Check your connection and try again."
        error={addresses.error}
        onRetry={() => void addresses.refetch()}
      />
    );
  }
  if (!addresses.data) return <AddressesSkeleton />;
  if (addresses.data.length === 0) {
    return (
      <EmptyState
        icon="pin"
        title="No saved addresses"
        body="Save where you'd like deliveries, and checkout fills it in for you."
        action={{ label: 'Add an address', onPress: addAddress }}
      />
    );
  }
  return (
    <>
      <ScrollView
        style={{ backgroundColor: theme.colors.bg }}
        contentContainerStyle={{ padding: theme.space[4], gap: theme.space[2], paddingBottom: theme.space[12] }}>
        {addresses.data.map((address) => (
          <AddressRow key={address.id} address={address} onDelete={() => setDeleting(address)} />
        ))}
        <Button label="Add an address" variant="secondary" icon="plus" onPress={addAddress} style={{ marginTop: theme.space[2] }} />
      </ScrollView>
      <DeleteAddressModal address={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}

/** A saved address by its street, with the area and the name the courier asks for, the rider's landmark, and what to do with it. */
function AddressRow({ address, onDelete }: Readonly<{ address: SavedAddressRecord; onDelete: () => void }>) {
  const theme = useTheme();
  const toast = useToast();
  const makeDefault = useMakeDefaultAddress();
  const unpinned = !pinOf(address);
  const { name, landmark } = addressLines(address);
  const { street, area } = streetAndArea(address);
  const tile = theme.shopMark.sm.size * (36 / 32);

  return (
    <View
      style={{
        gap: theme.space[2],
        padding: theme.space[3],
        borderWidth: theme.line.divider,
        borderColor: theme.colors.line,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.raised,
      }}>
      <View style={[styles.row, { gap: theme.space[2] }]}>
        <View style={[styles.centre, { width: tile, height: tile, borderRadius: theme.radius.md, backgroundColor: theme.colors.tile }]}>
          <Icon name={address.is_default_shipping ? 'home' : 'pin'} use="step" color={theme.colors.accent} />
        </View>
        <View style={styles.fill}>
          <Text variant="meta" weight="bold">
            {street}
          </Text>
          <Text variant="meta" tone="muted">
            {[area, name].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {address.is_default_shipping ? <StatusChip label="Default" tone="info" icon="check" /> : null}
        <PressableSurface
          accessibilityRole="button"
          accessibilityLabel={unpinned ? `Add a pin to ${street}` : `Edit ${street}`}
          onPress={() => editAddress(address)}
          style={[styles.centre, { minWidth: theme.hitArea, minHeight: theme.hitArea, borderRadius: theme.radius.md }]}>
          <Icon name="edit" use="step" color={theme.colors.muted} />
        </PressableSurface>
      </View>
      {landmark ? (
        <Text variant="meta" tone="muted">
          {landmark}
        </Text>
      ) : null}
      {unpinned ? <StatusChip label="Needs a pin" tone="attention" icon="pin" /> : null}
      <View style={[styles.row, styles.wrap, { gap: theme.space[4] }]}>
        {address.is_default_shipping ? null : (
          <Button
            label="Make default"
            variant="link"
            loading={makeDefault.isPending}
            onPress={() =>
              makeDefault.mutate(address.id, {
                onError: () => toast({ message: "Couldn't make it your default. Try again.", tone: 'problem' }),
              })
            }
            style={styles.link}
          />
        )}
        <Button label="Delete" variant="link" onPress={onDelete} style={styles.link} />
      </View>
    </View>
  );
}

/** A sheet, not a system alert: the address being deleted, then Delete in red and Cancel. */
function DeleteAddressModal({ address, onClose }: Readonly<{ address: SavedAddressRecord | null; onClose: () => void }>) {
  const toast = useToast();
  const remove = useDeleteAddress();
  const named = address ? streetAndArea(address) : null;
  return (
    <SheetModal visible={!!address} onClose={onClose} dismissible={!remove.isPending}>
      {address && named ? (
        <ConfirmSheet
          title="Delete this address?"
          message={[named.street, address.city?.trim()].filter(Boolean).join(', ')}
          confirmLabel="Delete"
          destructive
          loading={remove.isPending}
          onCancel={onClose}
          onConfirm={() =>
            remove.mutate(address.id, {
              onSuccess: onClose,
              onError: () => toast({ message: "Couldn't delete the address. Try again.", tone: 'problem' }),
            })
          }
        />
      ) : null}
    </SheetModal>
  );
}

function AddressesSkeleton() {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel="Loading your addresses"
      style={[styles.fill, { backgroundColor: theme.colors.bg, padding: theme.space[4], gap: theme.space[2] }]}>
      {[0, 1].map((i) => (
        <Skeleton key={i} height={theme.control.row * 2} radius="lg" />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexWrap: 'wrap' },
  centre: { alignItems: 'center', justifyContent: 'center' },
  link: { paddingHorizontal: 0 },
});
