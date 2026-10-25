import { guestSpotLabel } from '@oja/domain';
import { Button, Icon, InlineNote, PressableSurface, Sheet, Text, useTheme } from '@oja/ui';
import { router, useIsFocused } from 'expo-router';
import { useState } from 'react';

import { useAddressPrompt } from '@/delivering-to/address-prompt-provider';
import { useDeliveringTo } from '@/delivering-to/delivering-to-provider';

import { SheetModal } from './sheet-modal';

/**
 * "Where should we deliver?": a sheet over Home on every app start until it is put off, for a
 * signed-in buyer with no saved address (#101) or a guest with no spot (#109). The band and
 * Home's empty state bring it back.
 */
export function AddressPrompt() {
  const { shown } = useAddressPrompt();
  const { signedIn } = useDeliveringTo();
  const focused = useIsFocused();
  if (!signedIn) return <GuestPrompt visible={shown && focused} />;
  return <BuyerPrompt visible={shown && focused} />;
}

/**
 * A signed-in buyer's: searching opens the address entry at its search; using the current
 * location opens it locating the buyer, the quick path. "Enter it later" closes it until the app
 * next starts.
 */
function BuyerPrompt({ visible }: Readonly<{ visible: boolean }>) {
  const { dismiss } = useAddressPrompt();

  const enterAddress = () => {
    dismiss();
    router.push({ pathname: '/addresses/edit', params: { way: 'search' } });
  };
  const useLocation = () => {
    dismiss();
    router.push({ pathname: '/addresses/edit', params: { way: 'here' } });
  };

  return (
    <SheetModal visible={visible} onClose={dismiss}>
      <Sheet
        title="Where should we deliver?"
        message="We'll show the shops nearest to it first."
        actions={
          <>
            <Button label="Use my current location" icon="locate" size="main" onPress={useLocation} />
            <Button label="Enter it later" variant="secondary" onPress={dismiss} />
          </>
        }>
        <AddressSearchButton onPress={enterAddress} />
      </Sheet>
    </SheetModal>
  );
}

/**
 * A guest's (ADR 0015): their current location becomes the spot shops are measured from, kept on
 * the phone. Searching for an address needs an account (ADR 0002), so it is offered with sign-in,
 * and is all that's left once location is refused. From the band, a guest with a spot can locate
 * again. "Not now" closes it until the app next starts.
 */
function GuestPrompt({ visible }: Readonly<{ visible: boolean }>) {
  const { dismiss } = useAddressPrompt();
  const { spot, locate } = useDeliveringTo();
  const [locating, setLocating] = useState(false);
  const [problem, setProblem] = useState<'refused' | 'unavailable' | null>(null);

  const close = () => {
    setProblem(null);
    dismiss();
  };
  const signIn = () => {
    close();
    router.push('/sign-in');
  };
  const shareLocation = async () => {
    setProblem(null);
    setLocating(true);
    try {
      const located = await locate();
      if ('spot' in located) close();
      else setProblem('refused' in located ? 'refused' : 'unavailable');
    } finally {
      setLocating(false);
    }
  };

  const refused = problem === 'refused';
  const title = spot ? guestSpotLabel(spot) : 'Where should we deliver?';
  const message = guestMessage(refused, Boolean(spot));
  return (
    <SheetModal visible={visible} onClose={close}>
      <Sheet
        title={title}
        message={message}
        actions={
          <>
            {refused ? null : (
              <Button
                label={spot ? 'Use my current location again' : 'Use my current location'}
                icon="locate"
                size="main"
                loading={locating}
                onPress={() => void shareLocation()}
              />
            )}
            <Button
              label={spot ? 'Sign in to save an address' : 'Sign in to search an address'}
              variant={refused ? 'primary' : 'secondary'}
              size={refused ? 'main' : undefined}
              onPress={signIn}
            />
            <Button label="Not now" variant="link" onPress={close} />
          </>
        }>
        {problem === 'unavailable' ? (
          <InlineNote>{"We couldn't tell where you are. Try again, or sign in to search an address."}</InlineNote>
        ) : null}
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
      <Text weight="semibold" tone="muted">
        Street, estate or area
      </Text>
    </PressableSurface>
  );
}

/** What the guest's sheet says: why location can't be used, where shops are measured from, or what sharing it does. */
function guestMessage(refused: boolean, hasSpot: boolean): string {
  if (refused) {
    return "Location is off, so we can't find shops near you. Sign in to search for your address, or turn location on in Settings.";
  }
  if (hasSpot) return 'Shops are measured from where you were when you shared your location.';
  return "We'll show the shops nearest to you first.";
}
