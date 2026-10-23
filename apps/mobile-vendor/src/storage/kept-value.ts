import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

/**
 * A value kept on the phone (SecureStore) and held in memory, so code outside React reads it at
 * once and screens re-render when it changes. Memory matches the phone: a write that fails puts
 * the value back as it was, and rejects.
 */
export type KeptValue<T> = {
  get: () => T;
  /** Reads the kept value; a missing or unreadable one is `initial`. */
  hydrate: () => Promise<void>;
  save: (next: T) => Promise<void>;
  /** Back to `initial`, on the phone too. */
  forget: () => Promise<void>;
  use: () => T;
};

export function keptValue<T>(key: string, initial: T, codec: { parse: (stored: string) => T; stringify: (value: T) => string }): KeptValue<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  const set = (next: T) => {
    value = next;
    listeners.forEach((listener) => listener());
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const get = () => value;

  return {
    get,
    async hydrate() {
      try {
        const stored = await SecureStore.getItemAsync(key);
        set(stored === null ? initial : codec.parse(stored));
      } catch {
        set(initial);
      }
    },
    async save(next) {
      const previous = value;
      set(next);
      try {
        await SecureStore.setItemAsync(key, codec.stringify(next));
      } catch (error) {
        set(previous);
        throw error;
      }
    },
    async forget() {
      set(initial);
      await SecureStore.deleteItemAsync(key);
    },
    use: () => useSyncExternalStore(subscribe, get),
  };
}
