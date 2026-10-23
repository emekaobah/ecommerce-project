import { useLocalSearchParams } from 'expo-router';

import { PickupCodeScreen } from '@/screens/pickup-code/pickup-code-screen';

/** The code to collect one shop's order (`id`) of an order group (`group`) with, full screen. */
export default function PickupCodeRoute() {
  const { id, group } = useLocalSearchParams<{ id: string; group: string }>();
  return <PickupCodeScreen groupId={group} orderId={id} />;
}
