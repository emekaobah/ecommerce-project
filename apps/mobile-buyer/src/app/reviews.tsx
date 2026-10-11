import { useLocalSearchParams } from 'expo-router';

import type { ReviewKind } from '@/api/reviews';
import { ReviewsScreen } from '@/screens/reviews/reviews-screen';

export default function ReviewsRoute() {
  const { kind, id, title } = useLocalSearchParams<{ kind: ReviewKind; id: string; title: string }>();
  return <ReviewsScreen kind={kind} id={id} title={title} />;
}
