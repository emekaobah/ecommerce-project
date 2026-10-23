import { useAuth } from '@clerk/expo';
import { addressLines, pinOf } from '@oja/domain';
import {
  Button,
  ConfirmSheet,
  EmptyState,
  ErrorState,
  Group,
  GroupList,
  Icon,
  PressableSurface,
  Sheet,
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
  const [options, setOptions] = useState<SavedAddressRecord | null>(null);
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
        contentContainerStyle={{ paddingHorizontal: theme.space[4], gap: theme.space[2], paddingBottom: theme.space[12] }}>
        <GroupList>
          {addresses.data.map((address) => (
            <AddressRow key={address.id} address={address} onPress={() => setOptions(address)} />
          ))}
        </GroupList>
        <Button label="Add an address" variant="secondary" icon="plus" onPress={addAddress} style={{ marginTop: theme.space[2] }} />
      </ScrollView>
      <AddressOptionsModal address={options} onClose={() => setOptions(null)} onDelete={setDeleting} />
      <DeleteAddressModal address={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}

/**
 * A saved address by its street, with the area and the name the courier asks for, and the rider's
 * landmark: a flat row, as the catalogue draws it. Tapping it opens what can be done with it.
 */
function AddressRow({ address, onPress }: Readonly<{ address: SavedAddressRecord; onPress: () => void }>) {
  const theme = useTheme();
  const unpinned = !pinOf(address);
  const { name, landmark } = addressLines(address);
  const { street, area } = streetAndArea(address);
  const tile = theme.shopMark.sm.size * (36 / 32);

  return (
    <Group gap={2}>
      <PressableSurface
        accessibilityRole="button"
        accessibilityLabel={`${street}, ${[area, name].filter(Boolean).join(', ')}${address.is_default_shipping ? ', default' : ''}`}
        accessibilityHint="Edit, make default or delete"
        onPress={onPress}
        style={[styles.row, { gap: theme.space[3], minHeight: theme.hitArea, borderRadius: theme.radius.md }]}>
        <View style={[styles.centre, { width: tile, height: tile, borderRadius: theme.radius.md, backgroundColor: theme.colors.tile }]}>
          <Icon name={address.is_default_shipping ? 'home' : 'pin'} use="step" color={theme.colors.accent} />
        </View>
        <View style={styles.fill}>
          <Text weight="extrabold">{street}</Text>
          <Text variant="meta" tone="muted">
            {[area, name].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {address.is_default_shipping ? (
          <DefaultChip />
        ) : (
          <Icon name="edit" use="step" color={theme.colors.ink} />
        )}
      </PressableSurface>
      {landmark ? (
        <Text variant="meta" tone="muted">
          {landmark}
        </Text>
      ) : null}
      {unpinned ? <StatusChip label="Needs a pin" tone="attention" icon="pin" /> : null}
    </Group>
  );
}

/** "Default": a plain label in the indigo chip, not a status, so it carries no symbol. */
function DefaultChip() {
  const theme = useTheme();
  const { foreground, background } = theme.status.info;
  return (
    <View style={{ backgroundColor: background, borderRadius: theme.radius.pill, paddingHorizontal: theme.space[3], paddingVertical: theme.space[1] }}>
      <Text variant="label" weight="extrabold" style={{ color: foreground }}>
        Default
      </Text>
    </View>
  );
}

/** What can be done with one address: edit it (or add its pin), make it the default, or delete it. */
function AddressOptionsModal({
  address,
  onClose,
  onDelete,
}: Readonly<{ address: SavedAddressRecord | null; onClose: () => void; onDelete: (address: SavedAddressRecord) => void }>) {
  const toast = useToast();
  const makeDefault = useMakeDefaultAddress();
  return (
    <SheetModal visible={!!address} onClose={onClose}>
      {address ? (
        <Sheet
          title={streetAndArea(address).street}
          actions={
            <>
              <Button
                label={pinOf(address) ? 'Edit address' : 'Add a pin'}
                variant="secondary"
                icon={pinOf(address) ? 'edit' : 'pin'}
                onPress={() => {
                  onClose();
                  editAddress(address);
                }}
              />
              {address.is_default_shipping ? null : (
                <Button
                  label="Make default"
                  variant="secondary"
                  icon="home"
                  loading={makeDefault.isPending}
                  onPress={() =>
                    makeDefault.mutate(address.id, {
                      onSuccess: onClose,
                      onError: () => toast({ message: "Couldn't make it your default. Try again.", tone: 'problem' }),
                    })
                  }
                />
              )}
              <Button
                label="Delete address"
                variant="danger"
                onPress={() => {
                  onClose();
                  onDelete(address);
                }}
              />
              <Button label="Cancel" variant="secondary" onPress={onClose} />
            </>
          }
        />
      ) : null}
    </SheetModal>
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
  centre: { alignItems: 'center', justifyContent: 'center' },
});
