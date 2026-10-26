import * as SecureStore from "expo-secure-store"
import { useSyncExternalStore } from "react"
import { createKeptValue, type KeptValue, type KeptValueStorage } from "./kept-value"

/** The phone's keychain (SecureStore), where the apps keep their values. */
export const secureStorage: KeptValueStorage = {
  write: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key),
}

export type SecureKeptValue<T> = Omit<KeptValue<T>, "load" | "subscribe"> & {
  /** Reads the kept value; a missing or unreadable one is `initial`. */
  hydrate: () => Promise<void>
  use: () => T
}

/** A value kept in SecureStore (see `KeptValue`), read when the app is ready for it. */
export function keptValue<T>(
  key: string,
  initial: T,
  codec: { parse: (stored: string) => T; stringify: (value: T) => string },
): SecureKeptValue<T> {
  const value = createKeptValue({ key, initial, codec, storage: secureStorage })
  return {
    get: value.get,
    save: value.save,
    forget: value.forget,
    async hydrate() {
      value.load(await SecureStore.getItemAsync(key).catch(() => null))
    },
    use: () => useSyncExternalStore(value.subscribe, value.get),
  }
}
