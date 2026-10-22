import { addressLines } from '@oja/domain';
import { Text, useTheme } from '@oja/ui';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { useDeliveringTo } from '@/delivering-to/delivering-to-provider';

/**
 * "Delivering to" at the top of Home and Search (#43): the saved address shops are measured
 * from, which opens the list to switch it. A guest is asked to sign in, and a buyer without a
 * saved address to add one, and one whose addresses won't load to retry; until then listings
 * keep their usual order.
 */
export function DeliveringToPicker() {
  const theme = useTheme();
  const { address, saved, signedIn, failed, retry } = useDeliveringTo();

  const { label, value, onPress } = (() => {
    if (address) {
      return { label: 'Delivering to', value: addressLines(address).place, onPress: openPicker };
    }
    if (address === undefined) return { label: 'Delivering to', value: '…', onPress: undefined };
    if (!signedIn) return { label: null, value: 'Sign in to see shops near you', onPress: () => router.push('/sign-in') };
    if (failed || !saved) return { label: null, value: "Couldn't load your addresses. Tap to retry", onPress: retry };
    if (!saved.length) return { label: null, value: 'Add a delivery address', onPress: addAddress };
    return { label: null, value: 'Choose a delivery address', onPress: openPicker };
  })();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ? `${label} ${value}` : value}
      accessibilityHint={address ? 'Changes which address shops are measured from' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: theme.hitArea,
          gap: theme.space[2],
          paddingHorizontal: theme.space[4],
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.tile,
        },
        pressed && { opacity: 0.7 },
      ]}>
      <View style={[styles.text, { paddingVertical: theme.space[1] }]}>
        {label ? (
          <Text variant="meta" tone="muted">
            {label}
          </Text>
        ) : null}
        <Text variant="strong" numberOfLines={1}>
          {value}
        </Text>
      </View>
      {onPress ? <Text tone="muted">›</Text> : null}
    </Pressable>
  );
}

const openPicker = () => router.push('/delivering-to');
const addAddress = () => router.push('/addresses/edit');

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1 },
});
