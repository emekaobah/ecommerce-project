import type { BuyerActivityContent } from '@oja/domain';

export type TokenReport = { kind: 'push_to_start'; token: string } | { kind: 'activity'; activity_id: string; token: string; order_id?: string };

/** How a post went: `revoked` means the server no longer knows the key (its buyer signed out). */
export type PostResult = 'ok' | 'failed' | 'revoked';

export type OwedActivity = { order_id: string; url: string; content: BuyerActivityContent };

export type TokenReporterPorts = {
  /** The phone's key from the keychain; readable on a background launch once the phone has been unlocked. */
  readKey: () => Promise<string | null>;
  saveKey: (key: string) => Promise<void>;
  clearKey: () => Promise<void>;
  /** Needs a session: gets the phone its key (or keeps `key`), and links its Expo token. */
  register: (key: string | null, pushToken: string | null) => Promise<string>;
  /** Needs a session: forgets the phone on the server. */
  remove: (key: string) => Promise<void>;
  /** Needs only the key. */
  post: (key: string, report: TokenReport) => Promise<PostResult>;
  /** Needs a session: the accepted orders this phone should show and doesn't. */
  owed: (key: string) => Promise<OwedActivity[]>;
  /** Starts an activity on the phone, answering its id. Throws where iOS won't. */
  startActivity: (content: BuyerActivityContent, url: string) => string;
  recordStarted: (key: string, orderId: string, activityId: string) => Promise<void>;
  /** Below iOS 17.2 the server can't start activities, so the app does. */
  startsActivitiesItself: () => boolean;
  /** Ends this phone's activities on the phone itself. */
  endActivities: () => void;
};

const reportId = (report: TokenReport) => (report.kind === 'activity' ? `activity:${report.activity_id}` : 'push_to_start');

/**
 * Gets a phone's Live Activity tokens to the backend (ADR 0018). iOS hands them over at any time,
 * including on a background launch before Clerk has restored a session, so a token is posted with
 * the phone's own key, and waits in memory until the phone has one. iOS sends them again on later
 * launches, so nothing is lost by not keeping them on disk.
 *
 * Every step runs one after another, so a sign-out waits for what's under way and removes it.
 */
export function tokenReporter(ports: TokenReporterPorts) {
  const pending = new Map<string, TokenReport>();
  /** iOS sends this once a launch, so it's kept for whoever signs in next. */
  let pushToStart: string | null = null;
  let expoPushToken: string | null = null;
  let signedIn = false;
  /** Activities this launch started and the server hasn't heard of yet: order id to activity id. */
  const unrecorded = new Map<string, string>();
  let queue: Promise<unknown> = Promise.resolve();

  const run = (step: () => Promise<void>) => {
    queue = queue.then(step).catch((error) => console.warn('Reporting Live Activity tokens failed', error));
    return queue as Promise<void>;
  };

  const heldKey = async () => {
    try {
      return await ports.readKey();
    } catch (error) {
      // The keychain can't be read on a phone not unlocked since it restarted: iOS sends the tokens again later.
      console.warn('Reading the Live Activity key failed', error);
      return null;
    }
  };

  async function flush() {
    const key = await heldKey();
    if (!key) return;
    for (const [id, report] of [...pending]) {
      const result = await ports.post(key, report).catch((): PostResult => 'failed');
      if (result === 'revoked') {
        await ports.clearKey();
        return;
      }
      if (result === 'ok' && pending.get(id) === report) pending.delete(id);
    }
  }

  async function register() {
    const key = await ports.register(await heldKey(), expoPushToken);
    await ports.saveKey(key);
  }

  async function startOwed() {
    if (!signedIn || !ports.startsActivitiesItself()) return;
    const key = await heldKey();
    if (!key) return;
    for (const { order_id, url, content } of await ports.owed(key)) {
      if (unrecorded.has(order_id)) continue;
      try {
        unrecorded.set(order_id, ports.startActivity(content, url));
      } catch (error) {
        // Live Activities are off, or iOS has had enough of them: the next open tries again.
        console.warn('Starting a Live Activity failed', error);
      }
    }
    for (const [orderId, activityId] of [...unrecorded]) {
      await ports.recordStarted(key, orderId, activityId);
      unrecorded.delete(orderId);
    }
  }

  const add = (report: TokenReport) => {
    pending.set(reportId(report), report);
    void run(flush);
  };

  return {
    pushToStartToken(token: string) {
      pushToStart = token;
      add({ kind: 'push_to_start', token });
    },
    /** `orderId`: the shop order the activity's url names, which is how the server knows which it is. */
    activityToken(activityId: string, token: string, orderId?: string | null) {
      add({ kind: 'activity', activity_id: activityId, token, ...(orderId ? { order_id: orderId } : {}) });
    },
    /** A buyer's session is ready. Runs on every launch: it's how a key is issued and a phone changes hands. */
    signedIn() {
      signedIn = true;
      if (pushToStart) pending.set('push_to_start', { kind: 'push_to_start', token: pushToStart });
      void run(register);
      void run(flush);
      void run(startOwed);
    },
    /** The phone's Expo push token is known, which says which Expo pushes a start stands in for. */
    pushTokenRegistered(token: string) {
      expoPushToken = token;
      if (signedIn) void run(register);
    },
    /** The app came to the front, or anything else worth another try. */
    retry() {
      void run(flush);
      void run(startOwed);
    },
    /** Before sign-out, while the session still works. */
    async signingOut() {
      signedIn = false;
      expoPushToken = null;
      pending.clear();
      unrecorded.clear();
      try {
        // The server is about to forget their tokens, so these could never be updated, and one may show a pickup code.
        ports.endActivities();
      } catch (error) {
        console.warn('Ending the Live Activities failed', error);
      }
      await run(async () => {
        const key = await heldKey();
        if (!key) return;
        try {
          await ports.remove(key);
        } catch (error) {
          // The next buyer to sign in on the phone takes over its tokens.
          console.warn('Removing the phone from Live Activities failed', error);
        }
        await ports.clearKey();
      });
    },
    /** When everything asked for so far has finished. */
    idle: () => queue.then(() => {}),
  };
}
