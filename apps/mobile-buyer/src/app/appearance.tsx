import { AppearanceSheet } from '@oja/ui';
import { router } from 'expo-router';

export default function AppearanceRoute() {
  return <AppearanceSheet onDone={() => router.back()} />;
}
