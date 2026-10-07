import { useMutation, useQuery } from '@tanstack/react-query';

import { vendorClient } from './client';

export const quickAddKeys = {
  all: ['quick-add'] as const,
  lookup: (sellerId: string, barcode: string) => [...quickAddKeys.all, 'lookup', { sellerId, barcode }] as const,
};

const lookUp = async (barcode: string) => (await vendorClient.vendor.quickAdd.$barcode.query({ $barcode: barcode })).lookup;

/** What a scanned barcode is to the shop: a product it sells, one the catalogue has, or one to propose. */
export type BarcodeLookup = Awaited<ReturnType<typeof lookUp>>;

/** Looks a scanned barcode up for the current shop. */
export function useBarcodeLookup(sellerId: string, barcode: string) {
  return useQuery({ queryKey: quickAddKeys.lookup(sellerId, barcode), queryFn: () => lookUp(barcode) });
}

export type QuickAddRequest = Parameters<typeof vendorClient.vendor.quickAdd.mutate>[0];

/** Adds the scanned product to the shop: an offer on the catalogue's product, or a proposal with a photo. */
export function useQuickAdd() {
  return useMutation({ mutationFn: (request: QuickAddRequest) => vendorClient.vendor.quickAdd.mutate(request) });
}
