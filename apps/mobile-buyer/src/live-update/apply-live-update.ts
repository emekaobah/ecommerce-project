import { buyerLiveUpdateView, readBuyerLiveUpdateMessage } from '@oja/domain';
import { liveUpdateApplier } from '@oja/expo-live-update/applier';

/** What a data-only push from the backend does to the order's notification. Anything else that arrives is left alone. */
export const applyLiveUpdate = liveUpdateApplier({ read: readBuyerLiveUpdateMessage, idOf: (message) => message.order_id, viewOf: buyerLiveUpdateView });
