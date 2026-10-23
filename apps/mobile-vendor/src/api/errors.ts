import { ClientError } from '@oja/api-client';
import { useReportError } from '@oja/expo-sentry';

/** The API's own words when it refused a request with one of `statuses` (written for staff); null otherwise, which the screen words itself. */
export const refusedWith = (error: unknown, statuses: readonly number[]): string | null =>
  error instanceof ClientError && error.status !== undefined && statuses.includes(error.status) ? error.message : null;

/**
 * What to say of a failed request, just above the button it came from: the API's own words for
 * a refusal with one of `statuses`, else `fallback`, and then the error goes to Sentry. Null
 * while nothing has failed.
 */
export function useFailureMessage(error: unknown, statuses: readonly number[], fallback: string): string | null {
  const refusal = error ? refusedWith(error, statuses) : null;
  useReportError(refusal ? null : error, fallback);
  if (!error) return null;
  return refusal ?? fallback;
}
