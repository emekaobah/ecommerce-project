import { useAuth } from '@clerk/expo';
import { Button, Icon, PressableSurface, Sheet, Text, useTheme } from '@oja/ui';
import * as SecureStore from 'expo-secure-store';
import { router, useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';

import { useDeliveringTo } from '@/delivering-to/delivering-to-provider';

import { SheetModal } from './sheet-modal';

// Whether a buyer was already asked where to deliver lives on the device, one per buyer who has
// signed in here: the prompt is asked once, not every time Home opens.
const askedKey = (userId: string) => `oja.address-prompt.${userId}`;

async function wasAsked(userId: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(askedKey(userId))) === 'asked';
  } catch {
    // An unreadable keychain asks again rather than never.
    return false;
  }
}

async function rememberAsked(userId: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(askedKey(userId), 'asked');
  } catch {
    // An unwritable keychain may ask again next launch.
  }
}

/**
 * "Where should we deliver?": a sheet over Home for a signed-in buyer with no saved address,
 * asked once on this phone. Searching or using the current location both open the address
 * entry, which offers them; "Enter it later" closes it. A guest's band asks them to sign in instead.
 */
export function AddressPrompt() {
  const { userId } = useAuth();
  const { saved } = useDeliveringTo();
  const focused = useIsFocused();
  /** Whether this buyer was asked before: undefined until read. */
  const [asked, setAsked] = useState<{ userId: string; asked: boolean } | undefined>(undefined);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void wasAsked(userId).then((value) => {
      if (!cancelled) setAsked({ userId, asked: value });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const askedNow = asked && asked.userId === userId ? asked.asked : undefined;
  const visible = !!userId && focused && askedNow === false && saved?.length === 0;

  const close = () => {
    if (!userId) return;
    setAsked({ userId, asked: true });
    void rememberAsked(userId);
  };
  const enterAddress = () => {
    close();
    router.push('/addresses/edit');
  };

  return (
    <SheetModal visible={visible} onClose={close}>
      <Sheet
        title="Where should we deliver?"
        message="We'll show the shops nearest to it first."
        actions={
          <>
            <Button label="Use my current location" icon="locate" size="main" onPress={enterAddress} />
            <Button label="Enter it later" variant="secondary" onPress={close} />
          </>
        }>
        <AddressSearchButton onPress={enterAddress} />
      </Sheet>
    </SheetModal>
  );
}

/** Looks like the address search it opens: outlined, a search icon and "Street, estate or area". */
function AddressSearchButton({ onPress }: Readonly<{ onPress: () => void }>) {
  const theme = useTheme();
  return (
    <PressableSurface
      accessibilityRole="search"
      accessibilityLabel="Search for your address"
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
        minHeight: theme.control.row,
        paddingHorizontal: theme.space[4],
        borderRadius: theme.radius.md,
        borderWidth: theme.line.input,
        borderColor: theme.colors.control,
        backgroundColor: theme.colors.raised,
      }}>
      <Icon name="search" use="step" color={theme.colors.muted} />
      <Text tone="muted">Street, estate or area</Text>
    </PressableSurface>
  );
}
