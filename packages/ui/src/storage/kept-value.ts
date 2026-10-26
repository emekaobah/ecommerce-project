/** Where a kept value lives on the phone (SecureStore in the apps). */
export type KeptValueStorage = {
  write: (key: string, value: string) => Promise<void>
  remove: (key: string) => Promise<void>
}

/**
 * A value kept on the phone and held in memory, so code outside React reads it at once and
 * screens re-render when it changes. A change shows at once; memory then follows the phone:
 * writes reach it in the order they were made, and when the latest one fails the value goes back
 * to what the phone last kept. An earlier write that fails never undoes a later change.
 */
export type KeptValue<T> = {
  get: () => T
  subscribe: (listener: () => void) => () => void
  /** Takes what the phone holds, read by the caller: `null` (nothing kept, or unreadable) or one that won't parse is `initial`. */
  load: (stored: string | null) => void
  /** Shows `next` at once and keeps it; rejects when the phone can't keep it. */
  save: (next: T) => Promise<void>
  /** Back to `initial`, on the phone too. */
  forget: () => Promise<void>
}

export function createKeptValue<T>({
  key,
  initial,
  codec,
  storage,
}: Readonly<{
  key: string
  initial: T
  codec: { parse: (stored: string) => T; stringify: (value: T) => string }
  storage: KeptValueStorage
}>): KeptValue<T> {
  let value = initial
  // What the phone holds, as far as memory knows: where a failed write goes back to.
  let kept = initial
  // Each change takes the next number, so a write that settles late knows whether it is still the latest.
  let latest = 0
  // The phone's writes, one after another, so they land in the order they were made.
  let queue: Promise<unknown> = Promise.resolve()
  const listeners = new Set<() => void>()
  const set = (next: T) => {
    value = next
    listeners.forEach((listener) => listener())
  }
  const parse = (stored: string | null): T => {
    if (stored === null) return initial
    try {
      return codec.parse(stored)
    } catch {
      return initial
    }
  }
  /** Has the phone run `write` once the writes already on their way have landed. */
  const enqueue = (write: () => Promise<void>) => {
    const written = queue.then(write)
    queue = written.catch(() => undefined)
    return written
  }

  return {
    get: () => value,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    load(stored) {
      kept = parse(stored)
      set(kept)
    },
    async save(next) {
      const ticket = ++latest
      set(next)
      try {
        await enqueue(() => storage.write(key, codec.stringify(next)))
        kept = next
      } catch (error) {
        if (ticket === latest) set(kept)
        throw error
      }
    },
    async forget() {
      latest++
      set(initial)
      try {
        await enqueue(() => storage.remove(key))
      } finally {
        // Forgotten in memory even if the phone couldn't remove it, so a failed write never brings it back.
        kept = initial
      }
    },
  }
}
