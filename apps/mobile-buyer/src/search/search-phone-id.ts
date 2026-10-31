import { randomUUID } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

// The anonymous id the searches this phone uses are recorded with (#124), so one phone counts once
// towards a popular search however often it searches. Random, made on the phone, and the same
// whoever is signed in: never the buyer's id.

const KEY = 'oja.search-phone-id';

let phoneId: Promise<string> | null = null;

async function readOrMake(): Promise<string> {
  try {
    const stored = await SecureStore.getItemAsync(KEY);
    if (stored) return stored;
  } catch {
    // An unreadable keychain makes a new id rather than failing.
  }
  const made = randomUUID();
  try {
    await SecureStore.setItemAsync(KEY, made);
  } catch {
    // An unwritable keychain keeps it for this session only.
  }
  return made;
}

/** The phone's search id, read once a session; `fresh` reads it again (for tests: as after a restart). */
export function readSearchPhoneId({ fresh = false }: { fresh?: boolean } = {}): Promise<string> {
  if (fresh || !phoneId) phoneId = readOrMake();
  return phoneId;
}
