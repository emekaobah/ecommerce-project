import { EmptyState, useTheme, type EmptyStateProps } from '@oja/ui';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Stands in for a screen whose slice hasn't been built yet. */
export function PlaceholderScreen({
  title,
  message,
  action,
}: Readonly<{
  title: string;
  message?: string;
  /** Leads on to the next slot, so every route is reachable before its slice lands. */
  action?: EmptyStateProps['action'];
}>) {
  const theme = useTheme();
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <EmptyState title={title} message={message ?? 'Coming soon.'} action={action} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
