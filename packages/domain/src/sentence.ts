/** Sentence-ending punctuation, before any closing quotes or brackets. */
const ENDED = /[.!?]["'”’)\]]*$/

/**
 * Text staff wrote (a reject reason, a cancel note) as a sentence that another can follow: trimmed,
 * with a full stop added only when it doesn't already end in one, a question or an exclamation mark.
 */
export function asSentence(text: string): string {
  const trimmed = text.trim()
  return ENDED.test(trimmed) ? trimmed : `${trimmed}.`
}
