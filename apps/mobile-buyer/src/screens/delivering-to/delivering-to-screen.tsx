import { addressLines, pinOf } from '@oja/domain';
import { Button, EmptyState, LoadingState, RadioOption, Text, useTheme } from '@oja/ui';
import { router } from 'expo-router';
import { ScrollView } from 'react-native';

import { useDeliveringTo } from '@/delivering-to/delivering-to-provider';

const addAddress = () => router.push('/addresses/edit');

/**
 * Picks the saved address Home and Search measure shops from, and checkout starts on (#43).
 * An address saved before pins were required can't be measured from until it has one.
 */
export function DeliveringToScreen() {
  const theme = useTheme();
  const { address: current, saved, pick } = useDeliveringTo();

  if (!saved) return <LoadingState />;
  if (!saved.length) {
    return (
      <EmptyState
        title="No saved addresses"
        message="Add where you'd like deliveries to see the shops nearest you."
        action={{ label: 'Add a delivery address', onPress: addAddress }}
      />
    );
  }
  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.space.md, gap: theme.space.md }}
      accessibilityRole="radiogroup">
      {saved.map((address) => {
        const { name, place } = addressLines(address);
        const pinned = !!pinOf(address);
        return (
          <RadioOption
            key={address.id}
            selected={address.id === current?.id}
            disabled={!pinned}
            onPress={() => {
              pick(address.id);
              router.back();
            }}>
            <Text variant="label">{name}</Text>
            <Text tone="secondary">{place}</Text>
            {pinned ? null : <Text tone="secondary">Add a pin in Account → Addresses to deliver here.</Text>}
          </RadioOption>
        );
      })}
      <Button label="Add a delivery address" variant="secondary" onPress={addAddress} />
    </ScrollView>
  );
}
