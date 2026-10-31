import { describe, expect, mock, test } from 'bun:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';

mock.module('./client', () => ({ storeClient: {} }));

const { refreshAccountSummary, summaryKeys } = await import('./customer');

/** The Account screen's summary: mounted, with each fetch held in flight until it's answered. */
function mountSummary(queryClient: QueryClient) {
  const answers: ((count: number) => void)[] = [];
  const observer = new QueryObserver(queryClient, {
    queryKey: summaryKeys.me('user_1'),
    queryFn: () => new Promise<number>((resolve) => answers.push(resolve)),
  });
  observer.subscribe(() => {});
  return { observer, answers };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('refreshAccountSummary', () => {
  test("doesn't hold the write up while the counts load", () => {
    const queryClient = new QueryClient();
    mountSummary(queryClient);

    expect(refreshAccountSummary(queryClient)).toBeUndefined();
  });

  test('a summary fetch that started before the write is fetched again, not kept', async () => {
    const queryClient = new QueryClient();
    const summary = mountSummary(queryClient);

    refreshAccountSummary(queryClient);
    await settle();
    // The first fetch, from before the write, answers late with the old count.
    summary.answers[0]?.(2);
    summary.answers.at(-1)?.(3);
    await settle();

    expect(summary.answers).toHaveLength(2);
    expect(summary.observer.getCurrentResult().data).toBe(3);
  });
});
