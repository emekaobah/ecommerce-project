/**
 * An error's message, for results and records that report what went wrong. A
 * failed workflow run rejects with a plain `{ message }` object, not an Error.
 */
export const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === "string" ? message : String(error)
}
