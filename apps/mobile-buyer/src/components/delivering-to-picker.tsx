import { addressLines } from '@oja/domain';
import { Icon, PressableSurface, Text, useTheme } from '@oja/ui';
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { useDeliveringTo } from '@/delivering-to/delivering-to-provider';

/**
 * "Delivering to" on Home's band (#43): the saved address shops are measured from, which opens
 * the list to switch it. A guest is asked to sign in, since addresses belong to accounts; a buyer
 * without a saved address to add one, and one whose addresses won't load to retry. Until then
 * shops keep the store's order.
 */
export function DeliveringToPicker() {
  const theme = useTheme();
  const { address, saved, signedIn, error, retry } = useDeliveringTo();

  const { value, onPress, chooses } = (() => {
    if (address) return { value: addressLines(address).place, onPress: openPicker, chooses: true };
    if (address === undefined) return { value: '', onPress: undefined, chooses: false };
    if (!signedIn) return { value: 'Sign in to see shops near you', onPress: () => router.push('/sign-in'), chooses: false };
    if (error || !saved) return { value: "Couldn't load your addresses. Tap to retry", onPress: retry, chooses: false };
    if (!saved.length) return { value: 'Add a delivery address', onPress: addAddress, chooses: false };
    return { value: 'Choose a delivery address', onPress: openPicker, chooses: true };
  })();

  return (
    <PressableSurface
      accessibilityRole="button"
      accessibilityLabel={address ? `Delivering to ${value}` : value || 'Delivering to'}
      accessibilityHint={address ? 'Changes which address shops are measured from' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={[styles.row, { minHeight: theme.hitArea, gap: theme.space[2] }]}>
      <Icon name="pin" use="chip" color={theme.colors.onBand} />
      <Text variant="meta" weight="semibold" tone="onBand" numberOfLines={1} style={styles.shrink}>
        {value}
      </Text>
      {chooses ? <Icon name="down" use="chip" color={theme.colors.onBand} /> : null}
    </PressableSurface>
  );
}

const openPicker = () => router.push('/delivering-to');
const addAddress = () => router.push('/addresses/edit');

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  shrink: { flexShrink: 1 },
});
