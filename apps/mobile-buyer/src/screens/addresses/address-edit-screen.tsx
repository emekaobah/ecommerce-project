import { useAuth } from '@clerk/expo';
import type { Pin } from '@oja/domain';
import { EmptyState, ErrorState, LoadingState, useTheme } from '@oja/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';

import { useSaveAddress, useSavedAddresses, type SavedAddressRecord } from '@/api/addresses';
import { useCustomer } from '@/api/customer';
import { AddressEntry } from '@/components/address/address-entry';
import { useAddressDraft } from '@/components/address/use-address-draft';
import { ToggleRow } from '@/components/toggle-row';
import { useRegion } from '@/region/region-provider';

/**
 * Adds a saved address, or edits one (`id`), with the entry flow from checkout (ADR 0002):
 * search or current location, the per-country form, and a confirmed pin. `locate` starts
 * with the current location (Home's address prompt). An edit keeps the
 * address's pin unless the buyer moves it or picks another place, which needs a new one.
 */
export function AddressEditScreen() {
  const { id, locate } = useLocalSearchParams<{ id?: string; locate?: string }>();
  const { userId } = useAuth();
  const addresses = useSavedAddresses(userId);
  const { region } = useRegion();

  if (addresses.error && !addresses.data) {
    return (
      <ErrorState
        title="Couldn't load your addresses"
        body="Check your connection and try again." error={addresses.error}
        onRetry={() => void addresses.refetch()}
      />
    );
  }
  const countryCode = region?.countries?.[0]?.iso_2;
  if (!addresses.data || !region || !countryCode) return <LoadingState />;
  const saved = id ? addresses.data.find((a) => a.id === id) : undefined;
  if (id && !saved) {
    return (
      <EmptyState
        title="Address not found"
        body="It may have been deleted."
        action={{ label: 'Back to addresses', onPress: () => router.back() }}
      />
    );
  }
  return (
    <AddressEditor
      key={id ?? 'new'}
      saved={saved}
      isFirstAddress={addresses.data.length === 0}
      regionId={region.id}
      countryCode={countryCode}
      locateOnOpen={locate === '1'}
    />
  );
}

function AddressEditor({
  saved,
  isFirstAddress,
  regionId,
  countryCode,
  locateOnOpen,
}: Readonly<{
  saved: SavedAddressRecord | undefined;
  isFirstAddress: boolean;
  regionId: string;
  countryCode: string;
  locateOnOpen: boolean;
}>) {
  const theme = useTheme();
  const { userId } = useAuth();
  const customer = useCustomer(userId);
  const draft = useAddressDraft(countryCode, saved, customer.data ?? undefined);
  const save = useSaveAddress(countryCode);
  // The first address is the default; a default stays one.
  const alreadyDefault = isFirstAddress || !!saved?.is_default_shipping;
  const [makeDefault, setMakeDefault] = useState(alreadyDefault);

  const onSave = (confirmed: Pin) => {
    const result = draft.pinned(confirmed);
    if (!result.ok) return;
    save.mutate(
      { id: saved?.id, address: result.address, makeDefault: makeDefault && !saved?.is_default_shipping },
      { onSuccess: () => router.back() }
    );
  };

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={{ backgroundColor: theme.colors.bg }}
        contentContainerStyle={{ padding: theme.space[4], gap: theme.space[6] }}
        keyboardShouldPersistTaps="handled">
        <AddressEntry
          lookup={{ region_id: regionId }}
          {...draft.entry}
          onSave={onSave}
          saving={save.isPending}
          saveError={save.error}
          saveLabel="Save address"
          locateOnOpen={locateOnOpen}>
          {alreadyDefault ? null : (
            <ToggleRow label="Use for checkout by default" value={makeDefault} onChange={setMakeDefault} />
          )}
        </AddressEntry>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
