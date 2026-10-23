import { ClientError, failureMessage, isRefusal } from '@oja/api-client';
import { useReportError } from '@oja/expo-sentry';

/** The store answered "not found": an answer (it's gone), not a failure worth retrying. */
export const isNotFound = (error: unknown) => error instanceof ClientError && error.status === 404;

/** Checkout answered "already paid": the order is on its way, so the buyer waits instead of paying again. */
export const isAlreadyPaid = (error: unknown) => error instanceof ClientError && error.status === 409;

/**
 * What to say of a failed request, just above the button it came from (`failureMessage`): the
 * API's words for a 409 refusal, else the screen's own for the status (`byStatus`) or
 * `fallback`; anything but a 409 goes to Sentry. Null while nothing has failed.
 */
export function useFailureMessage(error: unknown, fallback: string, byStatus?: Readonly<Partial<Record<number, string>>>): string | null {
  useReportError(isRefusal(error) ? null : error, fallback);
  return error ? failureMessage(error, fallback, byStatus) : null;
}
