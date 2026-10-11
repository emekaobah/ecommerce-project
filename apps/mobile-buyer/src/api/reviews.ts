import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { storeClient } from './client';
import { orderKeys } from './orders';

/** What a review is of: a shop, or a catalogue product (whichever shop sold it). */
export type ReviewKind = 'seller' | 'product';

export const reviewKeys = {
  all: ['reviews'] as const,
  preview: (kind: ReviewKind, id: string) => [...reviewKeys.all, 'preview', { kind, id }] as const,
  pages: (kind: ReviewKind, id: string) => [...reviewKeys.all, 'pages', { kind, id }] as const,
};

/** How many reviews a product or shop page shows before "See all". */
export const REVIEW_PREVIEW_COUNT = 3;
const PAGE_SIZE = 20;

async function fetchPublishedReviews(kind: ReviewKind, id: string, page: { limit: number; offset: number }) {
  return kind === 'seller'
    ? storeClient.store.sellers.$id.reviews.query({ $id: id, ...page })
    : storeClient.store.products.$id.reviews.query({ $id: id, ...page });
}

/** A page of a shop's or product's published reviews, with the average and count of them all. */
export type PublishedReviews = Awaited<ReturnType<typeof fetchPublishedReviews>>;
export type PublishedReview = PublishedReviews['reviews'][number];

/** A shop's or product's rating and its newest few published reviews, for its page. */
export function useReviewPreview(kind: ReviewKind, id: string) {
  return useQuery({
    queryKey: reviewKeys.preview(kind, id),
    queryFn: () => fetchPublishedReviews(kind, id, { limit: REVIEW_PREVIEW_COUNT, offset: 0 }),
  });
}

/** Every published review of a shop or product, newest first, a page at a time. */
export function useReviewPages(kind: ReviewKind, id: string) {
  return useInfiniteQuery({
    queryKey: reviewKeys.pages(kind, id),
    queryFn: ({ pageParam }) => fetchPublishedReviews(kind, id, { limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const next = last.offset + last.reviews.length;
      return next < last.count ? next : undefined;
    },
  });
}

/** One review the buyer writes of a shop or product on their order. */
export type ReviewDraft = { reference: ReviewKind; reference_id: string; rating: number; customer_note: string | null };

/**
 * Submits the buyer's reviews of a received order, one per shop or product they rated. Each
 * waits for moderation, which the order then shows.
 */
export function useSubmitReviews() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, drafts }: { orderId: string; drafts: ReviewDraft[] }) => {
      for (const draft of drafts) await storeClient.store.reviews.mutate({ order_id: orderId, ...draft });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: orderKeys.all }),
  });
}
