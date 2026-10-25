import { useAuth } from '@clerk/expo';
import { addressPromptShown } from '@oja/domain';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { useDeliveringTo } from './delivering-to-provider';

type AddressPromptState = {
  /** Whether "Where should we deliver?" is up: a signed-in buyer without a saved address who hasn't put it off. */
  shown: boolean;
  /** Puts it off until the app next starts ("Enter it later", or a way to add the address was chosen). */
  dismiss: () => void;
  /** Asks again, from the band or Home's empty state. */
  open: () => void;
};

const AddressPromptContext = createContext<AddressPromptState | null>(null);

/**
 * When "Where should we deliver?" shows (#101): on every app start while the signed-in buyer has
 * no saved address. Putting it off lasts until the app is closed, so it is kept in memory only.
 */
export function AddressPromptProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { userId } = useAuth();
  const { saved } = useDeliveringTo();
  const [dismissedBy, setDismissedBy] = useState<string | null>(null);

  const dismiss = useCallback(() => setDismissedBy(userId ?? null), [userId]);
  const open = useCallback(() => setDismissedBy(null), []);
  const shown = addressPromptShown({ userId: userId ?? null, saved, dismissedBy });

  const value = useMemo(() => ({ shown, dismiss, open }), [shown, dismiss, open]);
  return <AddressPromptContext.Provider value={value}>{children}</AddressPromptContext.Provider>;
}

export function useAddressPrompt(): AddressPromptState {
  const state = useContext(AddressPromptContext);
  if (!state) throw new Error('useAddressPrompt must be used inside AddressPromptProvider');
  return state;
}
