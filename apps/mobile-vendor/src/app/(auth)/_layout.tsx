import { vendorTheme } from '@oja/ui';
import { Stack } from 'expo-router';

// The shop picker joins sign-in here.
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: vendorTheme.colors.background } }} />;
}
