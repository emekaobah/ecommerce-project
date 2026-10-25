import { deliveringToBand, type DeliveringToAction } from '@oja/domain';
import { Icon, PressableSurface, Text, useTheme } from '@oja/ui';
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { useAddressPrompt } from '@/delivering-to/address-prompt-provider';
import { useDeliveringTo } from '@/delivering-to/delivering-to-provider';

/**
 * "Delivering to" on Home's band (#43): the saved address shops are measured from, which opens
 * the list to switch it. A guest with a spot reads "Near <area>", which offers to locate them
 * again or sign in (#109); one without is asked to sign in, since addresses belong to accounts; a buyer
 * without a saved address to add one, through "Where should we deliver?" (#101), and one whose
 * addresses won't load to retry. While the address is worked out it says so, muted, in the same
 * shape. Until then shops keep the store's order.
 */
export function DeliveringToPicker() {
  const theme = useTheme();
  const { address, saved, signedIn, error, retry, near } = useDeliveringTo();
  const prompt = useAddressPrompt();
  const band = deliveringToBand({ address, saved, signedIn, error: !!error, spot: near });

  const actions: Record<DeliveringToAction, (() => void) | undefined> = {
    none: undefined,
    choose: () => router.push('/delivering-to'),
    signIn: () => router.push('/sign-in'),
    retry,
    addAddress: prompt.open,
    guestSpot: prompt.open,
  };
  const color = band.muted ? theme.colors.onBandSoft : theme.colors.onBand;

  return (
    <PressableSurface
      accessibilityRole="button"
      accessibilityLabel={address ? `Delivering to ${band.label}` : band.label}
      accessibilityHint={
        band.action === 'choose' || band.action === 'guestSpot' ? 'Changes where shops are measured from' : undefined
      }
      accessibilityState={{ busy: band.muted }}
      disabled={band.action === 'none'}
      onPress={actions[band.action]}
      style={[styles.row, { minHeight: theme.hitArea, gap: theme.space[2] }]}>
      <Icon name="pin" use="chip" color={color} />
      <Text variant="meta" weight="semibold" tone="onBand" numberOfLines={1} style={[styles.shrink, { color }]}>
        {band.label}
      </Text>
      {band.chooses ? <Icon name="down" use="chip" color={color} /> : null}
    </PressableSurface>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  shrink: { flexShrink: 1 },
});
