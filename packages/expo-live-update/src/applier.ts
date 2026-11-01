import type { LiveUpdateView } from '@oja/domain';

export type LiveUpdatePorts = {
  show: (view: LiveUpdateView) => void;
  cancel: (id: string, revision: number) => void;
};

/**
 * What a data-only push does to the notification, for one kind of message. Anything else that
 * arrives is left alone. A file of its own, with no native import, so a test can run it.
 */
export function liveUpdateApplier<Message extends { action: string; revision: number }>({
  read,
  idOf,
  viewOf,
}: {
  read: (payload: unknown) => Message | null;
  idOf: (message: Message) => string;
  viewOf: (message: Message) => LiveUpdateView;
}) {
  return (payload: unknown, { show, cancel }: LiveUpdatePorts): void => {
    const message = read(payload);
    if (!message) return;
    if (message.action === 'remove') cancel(idOf(message), message.revision);
    else show(viewOf(message));
  };
}
