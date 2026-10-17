import { useLocalSearchParams } from 'expo-router';

import { RefundAccountScreen } from '@/screens/refund-account/refund-account-screen';

/** A refund (`id`) that may need the buyer's bank account (#13), opened from its push or email. */
export default function RefundRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RefundAccountScreen refundId={id} />;
}
