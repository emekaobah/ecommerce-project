import { failureMessage, isRefusal } from '@oja/api-client';
import { useReportError } from '@oja/expo-sentry';

/**
 * What to say of a failed request, just above the button it came from (`failureMessage`): the
 * API's words for a 409 refusal, else the screen's own for the status (`byStatus`) or
 * `fallback`; anything but a 409 goes to Sentry. Null while nothing has failed.
 */
export function useFailureMessage(error: unknown, fallback: string, byStatus?: Readonly<Partial<Record<number, string>>>): string | null {
  useReportError(isRefusal(error) ? null : error, fallback);
  return error ? failureMessage(error, fallback, byStatus) : null;
}
