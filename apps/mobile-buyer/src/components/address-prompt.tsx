import { Button, Icon, PressableSurface, Sheet, Text, useTheme } from '@oja/ui';
import { router, useIsFocused } from 'expo-router';

import { useAddressPrompt } from '@/delivering-to/address-prompt-provider';

import { SheetModal } from './sheet-modal';

/**
 * "Where should we deliver?": a sheet over Home for a signed-in buyer with no saved address, on
 * every app start until they put it off (#101); the band and Home's empty state bring it back.
 * Searching opens the address entry at its search; using the current location opens it locating
 * the buyer, the quick path. "Enter it later" closes it until the app next starts. A guest's band
 * asks them to sign in instead.
 */
export function AddressPrompt() {
  const { shown, dismiss } = useAddressPrompt();
  const focused = useIsFocused();

  const enterAddress = () => {
    dismiss();
    router.push('/addresses/edit');
  };
  const useLocation = () => {
    dismiss();
    router.push({ pathname: '/addresses/edit', params: { locate: '1' } });
  };

  return (
    <SheetModal visible={shown && focused} onClose={dismiss}>
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
