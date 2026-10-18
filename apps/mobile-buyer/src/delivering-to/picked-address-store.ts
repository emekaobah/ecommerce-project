import * as SecureStore from 'expo-secure-store';

// The saved address the buyer picked to deliver to (#43) lives on the device, one per buyer
// who has signed in here, until they pick another.

const keyFor = (userId: string) => `oja.delivering-to.${userId}`;

export async function readPickedAddressId(userId: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(keyFor(userId));
  } catch {
    // An unreadable keychain falls back to the default address.
    return null;
  }
}

export async function savePickedAddressId(userId: string, addressId: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(keyFor(userId), addressId);
  } catch {
    // An unwritable keychain keeps the pick for this session only.
  }
}
