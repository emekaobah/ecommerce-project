import { ApiError, ClientError, failureMessage, isRefusal } from '@oja/api-client';
import { checkoutRefusalMessage } from '@oja/domain';
import { useReportError } from '@oja/expo-sentry';

/** The store answered "not found": an answer (it's gone), not a failure worth retrying. */
export const isNotFound = (error: unknown) => error instanceof ClientError && error.status === 404;

/** Checkout answered "already paid": the order is on its way, so the buyer waits instead of paying again. */
export const isAlreadyPaid = (error: unknown) => error instanceof ClientError && error.status === 409;

/**
 * What to say of a failed request, just above the button it came from (`failureMessage`): the
 * API's words for a 409 refusal; plain words for a checkout refusal the API labelled with a
 * code the app knows (a promo code, a shop that doesn't deliver to the address, #106); else the
 * screen's own for the status (`byStatus`) or `fallback`. Only the last go to Sentry. Null
 * while nothing has failed.
 */
export function useFailureMessage(error: unknown, fallback: string, byStatus?: Readonly<Partial<Record<number, string>>>): string | null {
  const coded = !isRefusal(error) && error instanceof ApiError ? checkoutRefusalMessage(error.body) : null;
  useReportError(isRefusal(error) || coded ? null : error, fallback);
  if (!error) return null;
  return coded ?? failureMessage(error, fallback, byStatus);
}
