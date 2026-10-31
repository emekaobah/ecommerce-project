import { addressBook, savedAddressEdit, type PinnedDeliveryAddress } from '@oja/domain';
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { storeClient } from './client';
import { summaryKeys } from './customer';

// The buyer's saved delivery addresses (#18): Medusa's customer addresses, the landmark and the
// pin they confirmed in each one's metadata (ADR 0002).

export const addressKeys = {
  all: ['addresses'] as const,
  /** Keyed by Clerk user so one buyer never sees another's cached addresses. */
  list: (userId: string) => [...addressKeys.all, { userId }] as const,
};

async function fetchAddresses() {
  const { addresses } = await storeClient.store.customers.me.addresses.query({ limit: 50, fields: '*' });
  return addressBook(addresses);
}

export type SavedAddressRecord = Awaited<ReturnType<typeof fetchAddresses>>[number];

/** The signed-in buyer's saved addresses, the default first. Idle for guests. */
export function useSavedAddresses(userId: string | null | undefined) {
  return useQuery({
    queryKey: addressKeys.list(userId ?? ''),
    queryFn: userId ? fetchAddresses : skipToken,
  });
}

/** What an address change shows on: the address book and the Account counts. */
function useRefetchAddressesAfterWrite() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: addressKeys.all }),
      queryClient.invalidateQueries({ queryKey: summaryKeys.all }),
    ]);
}

/** Saves a new address, or an edit of a saved one (`id`), with the pin the buyer confirmed. */
export function useSaveAddress(countryCode: string) {
  const onSettled = useRefetchAddressesAfterWrite();
  return useMutation({
    mutationFn: async ({
      id,
      address,
      makeDefault,
    }: {
      id?: string;
      address: PinnedDeliveryAddress;
      makeDefault?: boolean;
    }) => {
      const asDefault = makeDefault ? { is_default_shipping: true } : {};
      if (id) {
        await storeClient.store.customers.me.addresses.$addressId.mutate({
          $addressId: id,
          ...savedAddressEdit(address, countryCode),
          ...asDefault,
        });
        return;
      }
      await storeClient.store.customers.me.addresses.mutate({ ...address, ...asDefault });
    },
    onSettled,
  });
}

/** Makes a saved address the one checkout starts with. */
export function useMakeDefaultAddress() {
  const onSettled = useRefetchAddressesAfterWrite();
  return useMutation({
    mutationFn: (id: string) =>
      storeClient.store.customers.me.addresses.$addressId.mutate({ $addressId: id, is_default_shipping: true }),
    onSettled,
  });
}

/** Deletes a saved address; carts and orders already delivered to it keep their own copy. */
export function useDeleteAddress() {
  const onSettled = useRefetchAddressesAfterWrite();
  return useMutation({
    mutationFn: (id: string) => storeClient.store.customers.me.addresses.$addressId.delete({ $addressId: id }),
    onSettled,
  });
}
