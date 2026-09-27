import { ClientError } from '@oja/api-client';

/** The store answered "not found": an answer (it's gone), not a failure worth retrying. */
export const isNotFound = (error: unknown) => error instanceof ClientError && error.status === 404;
