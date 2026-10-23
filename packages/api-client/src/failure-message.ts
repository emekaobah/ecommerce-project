import { ClientError } from "@mercurjs/client"

/** The only answer whose own words reach the screen: a 409, a business refusal the API writes for the person reading it. */
const REFUSAL = 409

/** Whether a failed request is a refusal the screen shows in the API's words; anything else goes to Sentry. */
export const isRefusal = (error: unknown): boolean => error instanceof ClientError && error.status === REFUSAL

/**
 * What a screen says of a failed request (both apps): the API's own words for a 409 refusal;
 * otherwise the screen's words for that status when it knows the case (`byStatus`, e.g. 403
 * "Only the owner or a manager can…"), else `fallback`. A 400 is never shown as it came: its
 * text may be written for developers ("Stage must be one of…").
 */
export function failureMessage(error: unknown, fallback: string, byStatus: Readonly<Partial<Record<number, string>>> = {}): string {
  if (isRefusal(error)) return (error as ClientError).message
  const status = error instanceof ClientError ? error.status : undefined
  return (status !== undefined ? byStatus[status] : undefined) ?? fallback
}
