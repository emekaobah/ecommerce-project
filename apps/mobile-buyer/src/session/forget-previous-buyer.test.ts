import { describe, expect, test } from 'bun:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { forgetPreviousBuyer } from './forget-previous-buyer';

/** A screen's query: mounted, with each fetch held in flight until `answer` is called. */
function mountQuery(queryClient: QueryClient, key: string) {
  const answers: ((value: string) => void)[] = [];
  const observer = new QueryObserver(queryClient, {
    queryKey: [key],
    queryFn: () => new Promise<string>((resolve) => answers.push(resolve)),
  });
  const seen: (string | undefined)[] = [];
  observer.subscribe((result) => seen.push(result.data));
  return { observer, seen, answer: (value: string) => answers.at(-1)?.(value) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('forgetPreviousBuyer', () => {
  test('a query mounted in the same commit as the buyer change still resolves', async () => {
    const queryClient = new QueryClient();
    const summary = mountQuery(queryClient, 'summary');

    forgetPreviousBuyer(queryClient);
    await settle();
    summary.answer('3 addresses');
    await settle();

    expect(summary.observer.getCurrentResult().data).toBe('3 addresses');
  });

  test("the previous buyer's data never shows for the next buyer", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['orders'], "Ada's orders");
    queryClient.setQueryData(['summary'], "Ada's summary");
    const summary = mountQuery(queryClient, 'summary');

    forgetPreviousBuyer(queryClient);
    const seenAfterChange = summary.seen.length;
    await settle();
    summary.answer("Bola's summary");
    await settle();

    expect(queryClient.getQueryCache().find({ queryKey: ['orders'] })).toBeUndefined();
    expect(summary.seen.slice(seenAfterChange)).not.toContain("Ada's summary");
    expect(summary.observer.getCurrentResult().data).toBe("Bola's summary");
  });
});
