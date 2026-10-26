import { keptValue } from '@oja/ui';

/**
 * How a new order shows while the app is open (#83): full screen, or as a banner. A setting of
 * this phone, not of the member or shop, so it outlives sign-out (catalogue a11y 2.2.4, 3.2.5).
 */
export type NewOrderAlertMode = 'takeover' | 'banner';

// Held outside React so the push handler can read it when a push arrives. Full screen until it
// is read, or if it can't be: a new order still takes over the screen.
const mode = keptValue<NewOrderAlertMode>('new-order-alert', 'takeover', {
  parse: (stored) => (stored === 'banner' ? 'banner' : 'takeover'),
  stringify: (value) => value,
});

export const getNewOrderAlertMode = mode.get;

/** Restores the phone's choice. */
export const hydrateNewOrderAlertMode = mode.hydrate;

/** Keeps the phone's choice; rejects when the phone can't keep it. */
export const setNewOrderAlertMode = mode.save;

export const useNewOrderAlertMode = mode.use;
