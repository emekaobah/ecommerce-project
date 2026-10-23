import { ClientError } from '@oja/api-client';

/** The store answered "not found": an answer (it's gone), not a failure worth retrying. */
export const isNotFound = (error: unknown) => error instanceof ClientError && error.status === 404;

/** Checkout answered "already paid": the order is on its way, so the buyer waits instead of paying again. */
export const isAlreadyPaid = (error: unknown) => error instanceof ClientError && error.status === 409;

/**
 * The API's own words when it refused a request with one of `statuses`: those answers are
 * written for the buyer. Null for any other failure, which the screen words itself (the error
 * goes to Sentry, never on screen).
 */
export const refusedWith = (error: unknown, statuses: readonly number[]): string | null =>
  error instanceof ClientError && error.status !== undefined && statuses.includes(error.status) ? error.message : null;
