/** An error's message, for results and records that report what went wrong. */
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
