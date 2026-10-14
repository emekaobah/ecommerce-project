import { useLocalSearchParams } from 'expo-router';

import { WriteReviewScreen } from '@/screens/write-review/write-review-screen';

/** Reviewing one shop's order (`id`) of an order group (`group`). */
export default function WriteReviewRoute() {
  const { id, group } = useLocalSearchParams<{ id: string; group: string }>();
  return <WriteReviewScreen groupId={group} orderId={id} />;
}
