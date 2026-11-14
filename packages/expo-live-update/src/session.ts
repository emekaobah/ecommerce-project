// The id a phone makes up for each sign-in (#133). It's registered with the phone's push token, and
// the backend stamps it on every Live Update message to the phone, so a message that arrives after
// its person signed out (Firebase holds them while the phone is offline) is recognised and not drawn.
// No native import, so a test can run it.

/** What of expo-secure-store this needs; the app passes its own copy (ADR 0012). */
export type SessionStore = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
};

const KEY = 'oja.live-update.session';

const freshId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

/** This sign-in's id, made the first time it's asked for after a sign-in. */
export async function liveUpdateSession(store: SessionStore): Promise<string> {
  const held = await store.getItemAsync(KEY);
  if (held) return held;
  const made = freshId();
  await store.setItemAsync(KEY, made);
  return made;
}

/** The id as it stands, or null while nobody is signed in: what the background task checks messages against. */
export async function currentLiveUpdateSession(store: SessionStore): Promise<string | null> {
  try {
    return await store.getItemAsync(KEY);
  } catch {
    // Unreadable before the phone's first unlock: no message is drawn until it is.
    return null;
  }
}

/** At sign-out: messages for the sign-in that's ending are no longer drawn. */
export async function endLiveUpdateSession(store: SessionStore): Promise<void> {
  await store.deleteItemAsync(KEY);
}
