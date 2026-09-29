import { ClientError } from '@oja/api-client';

/** The store answered "not found": an answer (it's gone), not a failure worth retrying. */
export const isNotFound = (error: unknown) => error instanceof ClientError && error.status === 404;

/** Checkout answered "already paid": the order is on its way, so the buyer waits instead of paying again. */
export const isAlreadyPaid = (error: unknown) => error instanceof ClientError && error.status === 409;
