import { addressLines, pinOf } from '@oja/domain';
import { Button, EmptyState, ErrorState, RadioOption, Skeleton, Text, useTheme } from '@oja/ui';
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { useDeliveringTo } from '@/delivering-to/delivering-to-provider';

const addAddress = () => router.push('/addresses/edit');

/**
 * Picks the saved address Home and Search measure shops from, and checkout starts on (#43).
 * An address saved before pins were required can't be measured from until it has one.
 */
export function DeliveringToScreen() {
  const theme = useTheme();
  const { address: current, saved, error, retry, pick } = useDeliveringTo();

  if (error) {
    return <ErrorState title="Couldn't load your addresses" body="Check your connection and try again." error={error} onRetry={retry} />;
  }
  if (!saved) {
    return (
      <View accessible accessibilityLabel="Loading your addresses" style={{ flex: 1, backgroundColor: theme.colors.bg, padding: theme.space[4], gap: theme.space[4] }}>
        {[0, 1].map((i) => (
          <Skeleton key={i} height={theme.control.row * 1.5} radius="md" />
        ))}
      </View>
    );
  }
  if (!saved.length) {
    return (
      <EmptyState
        icon="pin"
        title="No saved addresses"
        body="Add where you'd like deliveries to see the shops nearest you."
        action={{ label: 'Add a delivery address', onPress: addAddress }}
      />
    );
  }
  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.bg }}
      contentContainerStyle={{ padding: theme.space[4], gap: theme.space[4] }}
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
            <Text variant="strong">{name}</Text>
            <Text tone="muted">{place}</Text>
            {pinned ? null : <Text tone="muted">Add a pin in Account → Addresses to deliver here.</Text>}
          </RadioOption>
        );
      })}
      <Button label="Add a delivery address" variant="secondary" onPress={addAddress} />
    </ScrollView>
  );
}
