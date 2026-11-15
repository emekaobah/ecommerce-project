import { vendorLiveUpdateView, readVendorLiveUpdateMessage } from '@oja/domain';
import { liveUpdateApplier } from '@oja/expo-live-update/applier';

/** What a data-only push from the backend does to the shop's notification. Anything else that arrives is left alone. */
export const applyLiveUpdate = liveUpdateApplier({ read: readVendorLiveUpdateMessage, idOf: (message) => message.seller_id, viewOf: vendorLiveUpdateView });
