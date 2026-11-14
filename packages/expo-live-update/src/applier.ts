import type { LiveUpdateView } from '@oja/domain';

export type LiveUpdatePorts = {
  show: (view: LiveUpdateView) => void;
  cancel: (id: string, revision: number) => void;
};

/**
 * What a data-only push does to the notification, for one kind of message. Anything else that
 * arrives is left alone. A file of its own, with no native import, so a test can run it.
 */
export function liveUpdateApplier<Message extends { action: string; revision: number; session?: string | null }>({
  read,
  idOf,
  viewOf,
}: {
  read: (payload: unknown) => Message | null;
  idOf: (message: Message) => string;
  viewOf: (message: Message) => LiveUpdateView;
}) {
  /** `session`: the phone's current sign-in (`currentLiveUpdateSession`), null while signed out. */
  return (payload: unknown, { show, cancel }: LiveUpdatePorts, session: string | null): void => {
    const message = read(payload);
    if (!message) return;
    if (message.action === 'remove') return cancel(idOf(message), message.revision);
    // Nothing is drawn for a sign-in other than the phone's own: a late message for whoever signed
    // out could show their order, even its pickup code, to the next person. A message from a
    // backend that doesn't stamp one is drawn while someone is signed in.
    if (!session || (message.session !== undefined && message.session !== session)) return;
    show(viewOf(message));
  };
}
