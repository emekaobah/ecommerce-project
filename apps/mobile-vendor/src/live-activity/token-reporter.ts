export type TokenReport = { kind: 'push_to_start'; token: string } | { kind: 'activity'; activity_id: string; token: string; seller_id?: string };

/** How a post went: `revoked` means the server no longer knows the key (its member signed out). */
export type PostResult = 'ok' | 'failed' | 'revoked';

export type TokenReporterPorts<Session> = {
  /** The phone's key from the keychain; readable on a background launch once the phone has been unlocked. */
  readKey: () => Promise<string | null>;
  saveKey: (key: string) => Promise<void>;
  clearKey: () => Promise<void>;
  /** Needs a session: gets the phone its key, or keeps `key`. */
  register: (key: string | null) => Promise<string>;
  /** Needs a session, the one from just before sign-out: forgets the phone on the server. */
  remove: (key: string, session: Session) => Promise<void>;
  /** Needs only the key. */
  post: (key: string, report: TokenReport) => Promise<PostResult>;
};

const reportId = (report: TokenReport) => (report.kind === 'activity' ? `activity:${report.activity_id}` : 'push_to_start');

/**
 * Gets a phone's Live Activity tokens to the backend (ADR 0018), as the buyer app's reporter does.
 * iOS hands them over at any time, including on a background launch before the session is read,
 * so a token is posted with the phone's own key, and waits in memory until the phone has one. iOS
 * sends them again on later launches, so nothing is lost by not keeping them on disk.
 *
 * Every step runs one after another, so a sign-out waits for what's under way and removes it.
 */
export function tokenReporter<Session>(ports: TokenReporterPorts<Session>) {
  const pending = new Map<string, TokenReport>();
  /** iOS sends this once a launch, so it's kept for whoever signs in next. */
  let pushToStart: string | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  /** Queues a step, answering its result; what fails is logged too, and the steps after it still run. */
  const run = <T>(step: () => Promise<T>) => {
    const result = queue.then(step);
    queue = result.catch((error) => console.warn('Reporting Live Activity tokens failed', error));
    return result;
  };
  const inBackground = (step: () => Promise<unknown>) => {
    run(step).catch(() => {});
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
    const key = await ports.register(await heldKey());
    await ports.saveKey(key);
    return key;
  }

  const add = (report: TokenReport) => {
    pending.set(reportId(report), report);
    inBackground(flush);
  };

  return {
    pushToStartToken(token: string) {
      pushToStart = token;
      add({ kind: 'push_to_start', token });
    },
    /** `sellerId`: the shop the activity's url names, which is how the server knows which it is. */
    activityToken(activityId: string, token: string, sellerId?: string | null) {
      add({ kind: 'activity', activity_id: activityId, token, ...(sellerId ? { seller_id: sellerId } : {}) });
    },
    /** A member's session is ready. Runs on every launch: it's how a key is issued and a phone changes hands. */
    signedIn() {
      if (pushToStart) pending.set('push_to_start', { kind: 'push_to_start', token: pushToStart });
      inBackground(register);
      inBackground(flush);
    },
    /** The app came to the front, or anything else worth another try. */
    retry() {
      inBackground(flush);
    },
    /** The key as it stands, to read this phone's switch. Null before the phone has one. */
    currentKey: () => run(heldKey),
    /** The key the switch's save needs: it throws if the phone can't get one, so the switch flips back. */
    ensureKey: () =>
      run(async () => (await heldKey()) ?? (await register())),
    /** Before sign-out, with the session as it was. */
    async signingOut(session: Session | undefined) {
      pending.clear();
      inBackground(async () => {
        const key = await heldKey();
        if (!key) return;
        if (session !== undefined) {
          try {
            await ports.remove(key, session);
          } catch (error) {
            // The next member to sign in on the phone takes over its tokens.
            console.warn('Removing the phone from Live Activities failed', error);
          }
        }
        await ports.clearKey();
      });
      await queue;
    },
    /** When everything asked for so far has finished. */
    idle: () => queue.then(() => {}),
  };
}
