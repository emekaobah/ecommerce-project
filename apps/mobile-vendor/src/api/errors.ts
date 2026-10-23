import { ClientError } from '@oja/api-client';

/** The API's own words when it refused a request with one of `statuses` (written for staff); null otherwise, which the screen words itself. */
export const refusedWith = (error: unknown, statuses: readonly number[]): string | null =>
  error instanceof ClientError && error.status !== undefined && statuses.includes(error.status) ? error.message : null;
