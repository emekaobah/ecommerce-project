import { useAuth } from '@clerk/expo';
import { addressPromptShown, promptViewer } from '@oja/domain';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { useDeliveringTo } from './delivering-to-provider';

type AddressPromptState = {
  /**
   * Whether "Where should we deliver?" is up: for a signed-in buyer without a saved address, or a
   * guest without a spot, who hasn't put it off; or asked for again from the band or Home.
   */
  shown: boolean;
  /** Puts it off until the app next starts ("Enter it later", "Not now", or a way on was chosen). */
  dismiss: () => void;
  /** Asks again, from the band or Home's empty state. */
  open: () => void;
};

const AddressPromptContext = createContext<AddressPromptState | null>(null);

/**
 * When "Where should we deliver?" shows: on every app start while the signed-in buyer has no
 * saved address (#101), or the guest has no spot (#109). Putting it off lasts until the app is
 * closed, so it is kept in memory only.
 */
export function AddressPromptProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { isLoaded, userId } = useAuth();
  const { saved, near } = useDeliveringTo();
  const [choice, setChoice] = useState<{ by: string; shown: boolean } | null>(null);

  const viewer = promptViewer(userId ?? null);
  const dismiss = useCallback(() => setChoice({ by: viewer, shown: false }), [viewer]);
  const open = useCallback(() => setChoice({ by: viewer, shown: true }), [viewer]);
  const shown = addressPromptShown({ userId: isLoaded ? (userId ?? null) : undefined, saved, spot: near, choice });

  const value = useMemo(() => ({ shown, dismiss, open }), [shown, dismiss, open]);
  return <AddressPromptContext.Provider value={value}>{children}</AddressPromptContext.Provider>;
}

export function useAddressPrompt(): AddressPromptState {
  const state = useContext(AddressPromptContext);
  if (!state) throw new Error('useAddressPrompt must be used inside AddressPromptProvider');
  return state;
}
