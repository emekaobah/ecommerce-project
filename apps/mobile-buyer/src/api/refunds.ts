import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { storeClient } from './client';
import { orderKeys } from './orders';

export const refundKeys = {
  all: ['refunds'] as const,
  /** Keyed by Clerk user so one buyer never sees another's cached refund. */
  refund: (userId: string, refundId: string) => [...refundKeys.all, 'refund', { userId, refundId }] as const,
  banks: (userId: string, refundId: string) => [...refundKeys.all, 'banks', { userId, refundId }] as const,
};

async function fetchRefund(refundId: string) {
  const { refund } = await storeClient.store.refunds.$id.query({ $id: refundId });
  return refund;
}

/** A refund of one of the buyer's orders, and whether it needs their bank account (#13). */
export type BuyerRefund = Awaited<ReturnType<typeof fetchRefund>>;

/** The bank account the buyer enters. Kept in the screen only: it is sent to the API, never stored. */
export type RefundAccountInput = { bank_code: string; account_number: string };

/** One of the buyer's refunds. Idle for guests. */
export function useRefund(userId: string | null | undefined, refundId: string) {
  return useQuery({
    queryKey: refundKeys.refund(userId ?? '', refundId),
    queryFn: userId ? () => fetchRefund(refundId) : skipToken,
  });
}

/** The banks the refund can be sent to, by name. */
export function useRefundBanks(userId: string | null | undefined, refundId: string) {
  return useQuery({
    queryKey: refundKeys.banks(userId ?? '', refundId),
    queryFn: userId
      ? async () => (await storeClient.store.refunds.$id.banks.query({ $id: refundId })).banks
      : skipToken,
    staleTime: 60 * 60 * 1000,
  });
}

/** Paystack's name for the account's holder, for the buyer to confirm. */
export function useResolveRefundAccount(refundId: string) {
  return useMutation({
    mutationFn: async (input: RefundAccountInput) =>
      (await storeClient.store.refunds.$id.resolveAccount.mutate({ $id: refundId, ...input })).account,
  });
}

/** Has Paystack retry the refund to the confirmed account; the refund and the buyer's orders then show where it is. */
export function useRetryRefund(userId: string | null | undefined, refundId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RefundAccountInput) =>
      (await storeClient.store.refunds.$id.retry.mutate({ $id: refundId, ...input })).refund,
    onSuccess: (refund) => {
      queryClient.setQueryData(refundKeys.refund(userId ?? '', refundId), refund);
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
    },
  });
}
