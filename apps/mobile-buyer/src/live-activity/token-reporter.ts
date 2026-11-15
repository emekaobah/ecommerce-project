import { tokenReporter as sharedReporter, type TokenReporterPorts as SharedPorts } from '@oja/expo-live-activity';
import type { BuyerActivityContent } from '@oja/domain';

export type { PostResult, TokenReport } from '@oja/expo-live-activity';

export type OwedActivity = { order_id: string; url: string; content: BuyerActivityContent };

export type TokenReporterPorts = Omit<SharedPorts<void>, 'subjectField' | 'afterReporting' | 'beforeSignOut'> & {
  /** Needs a session: the accepted orders this phone should show and doesn't. */
  owed: (key: string) => Promise<OwedActivity[]>;
  /** Starts an activity on the phone, answering its id. Throws where iOS won't. */
  startActivity: (content: BuyerActivityContent, url: string) => string;
  recordStarted: (key: string, orderId: string, activityId: string) => Promise<void>;
  /** Below iOS 17.2 the server can't start activities, so the app does. */
  startsActivitiesItself: () => boolean;
};

/** The shared reporter, for the buyer: an activity is about a shop order, and below iOS 17.2 the phone starts its own. */
export function tokenReporter(ports: TokenReporterPorts) {
  /** Activities this launch started and the server hasn't heard of yet: order id to activity id. */
  const unrecorded = new Map<string, string>();

  async function startOwed(key: string) {
    if (!ports.startsActivitiesItself()) return;
    for (const { order_id, url, content } of await ports.owed(key)) {
      if (unrecorded.has(order_id)) continue;
      try {
        unrecorded.set(order_id, ports.startActivity(content, url));
      } catch (error) {
        // Live Activities are off, or iOS has had enough of them: the next open tries again.
        console.warn('Starting a Live Activity failed', error);
      }
    }
    await Promise.all(
      Array.from(unrecorded, async ([orderId, activityId]) => {
        await ports.recordStarted(key, orderId, activityId);
        unrecorded.delete(orderId);
      })
    );
  }

  return sharedReporter<void>({ ...ports, subjectField: 'order_id', afterReporting: startOwed, beforeSignOut: () => unrecorded.clear() });
}
