import { Button, StatusChip, Text, useTheme } from '@oja/ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

/** Confirms a quick-add: the product is on sale in the shop, or sent to the catalogue's review. */
export function QuickAddDoneScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { result, title } = useLocalSearchParams<{ result: 'offered' | 'proposed'; title: string }>();
  const proposed = result === 'proposed';

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: theme.space[6], gap: theme.space[4] }}>
      <Stack.Screen options={{ title: proposed ? 'Sent for review' : 'Added' }} />
      <StatusChip label={proposed ? 'In review' : 'On sale'} tone={proposed ? 'warning' : 'success'} />
      <Text variant="titlePushed">{proposed ? `${title} is sent for review` : `${title} is in your shop`}</Text>
      <Text tone="muted">
        {proposed
          ? 'The catalogue team checks it before buyers see it. It goes on sale at your price once approved.'
          : 'Buyers can order it now. Your shop owner can see you added it.'}
      </Text>
      <Button label="Scan another" onPress={() => router.replace('/quick-add')} />
      <Button label="Back to orders" variant="link" onPress={() => router.dismissTo('/')} />
    </View>
  );
}
