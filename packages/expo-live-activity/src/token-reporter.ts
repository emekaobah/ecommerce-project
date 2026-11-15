export type TokenReport =
  | { kind: 'push_to_start'; token: string }
  | { kind: 'activity'; activity_id: string; token: string; order_id?: string; seller_id?: string };

/** How a post went: `revoked` means the server no longer knows the key (whoever had the phone signed out). */
export type PostResult = 'ok' | 'failed' | 'revoked';

export type PhoneKeyPorts<Session> = {
  /** The phone's key from the keychain; readable on a background launch once the phone has been unlocked. */
  readKey: () => Promise<string | null>;
  saveKey: (key: string) => Promise<void>;
  clearKey: () => Promise<void>;
  /** Needs a session: gets the phone its key (or keeps `key`), and links its Expo token. */
  register: (key: string | null, pushToken: string | null) => Promise<string>;
  /** Needs a session, the one from just before sign-out: forgets the phone on the server. */
  remove: (key: string, session: Session) => Promise<void>;
  /** Clears what the phone is showing: the server is about to forget it, and it may show a pickup code. */
  endActivities: () => void;
};

type PhoneKeyHooks = {
  /** A session is ready and the phone has asked for its key. */
  afterSignIn?: () => void;
  beforeSignOut?: () => void;
};

/**
 * A phone's key (ADR 0018) and the steps that use it, one after another, so a sign-out waits for
 * what's under way and removes it. All an Android phone needs: it has no Apple tokens to report.
 */
export function phoneKey<Session = void>(ports: PhoneKeyPorts<Session>, hooks: PhoneKeyHooks = {}) {
  let pushToken: string | null = null;
  let signedIn = false;
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

  async function register() {
    const key = await ports.register(await heldKey(), pushToken);
    await ports.saveKey(key);
    return key;
  }

  return {
    run,
    inBackground,
    heldKey,
    isSignedIn: () => signedIn,
    clearKey: ports.clearKey,
    /** Someone's session is ready. Runs on every launch: it's how a key is issued and a phone changes hands. */
    signedIn() {
      signedIn = true;
      inBackground(register);
      hooks.afterSignIn?.();
    },
    /** The phone's Expo push token is known: what the server reaches an Android phone by, and which Expo pushes a start stands in for. */
    pushTokenRegistered(token: string) {
      pushToken = token;
      if (signedIn) inBackground(register);
    },
    /** The key as it stands, to read this phone's switch. Null before the phone has one. */
    currentKey: () => run(heldKey),
    /** The key the switch's save needs: it throws if the phone can't get one, so the switch flips back. */
    ensureKey: () => run(async () => (await heldKey()) ?? (await register())),
    /** Before sign-out, with the session as it was. */
    async signingOut(session: Session) {
      signedIn = false;
      pushToken = null;
      hooks.beforeSignOut?.();
      try {
        ports.endActivities();
      } catch (error) {
        console.warn('Ending the Live Activities failed', error);
      }
      inBackground(async () => {
        const key = await heldKey();
        if (!key) return;
        try {
          await ports.remove(key, session);
        } catch (error) {
          // The next person to sign in on the phone takes over its tokens.
          console.warn('Removing the phone from Live Activities failed', error);
        }
        await ports.clearKey();
      });
      await queue;
    },
    /** When everything asked for so far has finished. */
    idle: () => queue.then(() => {}),
  };
}

export type TokenReporterPorts<Session> = PhoneKeyPorts<Session> & {
  /** Needs only the key. */
  post: (key: string, report: TokenReport) => Promise<PostResult>;
  /** The report's field for what an activity's url names. */
  subjectField: 'order_id' | 'seller_id';
  /** What else a signed-in phone does once its tokens are reported, on each sign-in and retry. */
  afterReporting?: (key: string) => Promise<void>;
  beforeSignOut?: () => void;
};

const reportId = (report: TokenReport) => (report.kind === 'activity' ? `activity:${report.activity_id}` : 'push_to_start');

/**
 * Gets a phone's Live Activity tokens to the backend (ADR 0018). iOS hands them over at any time,
 * including on a background launch before a session is restored, so a token is posted with the
 * phone's own key, and waits in memory until the phone has one. iOS sends them again on later
 * launches, so nothing is lost by not keeping them on disk.
 */
export function tokenReporter<Session = void>(ports: TokenReporterPorts<Session>) {
  const pending = new Map<string, TokenReport>();
  /** iOS sends this once a launch, so it's kept for whoever signs in next. */
  let pushToStart: string | null = null;

  async function flush() {
    const key = await phone.heldKey();
    if (!key) return;
    for (const [id, report] of pending) {
      const result = await ports.post(key, report).catch((): PostResult => 'failed');
      if (result === 'revoked') {
        await phone.clearKey();
        return;
      }
      if (result === 'ok' && pending.get(id) === report) pending.delete(id);
    }
  }

  async function afterReporting() {
    if (!ports.afterReporting || !phone.isSignedIn()) return;
    const key = await phone.heldKey();
    if (key) await ports.afterReporting(key);
  }

  const reportAll = () => {
    phone.inBackground(flush);
    phone.inBackground(afterReporting);
  };

  const phone = phoneKey<Session>(ports, {
    afterSignIn: () => {
      if (pushToStart) pending.set('push_to_start', { kind: 'push_to_start', token: pushToStart });
      reportAll();
    },
    beforeSignOut: () => {
      pending.clear();
      ports.beforeSignOut?.();
    },
  });

  const add = (report: TokenReport) => {
    pending.set(reportId(report), report);
    phone.inBackground(flush);
  };

  return {
    ...phone,
    pushToStartToken(token: string) {
      pushToStart = token;
      add({ kind: 'push_to_start', token });
    },
    /** `subject`: what the activity's url names, which is how the server knows which it is. */
    activityToken(activityId: string, token: string, subject?: string | null) {
      add({ kind: 'activity', activity_id: activityId, token, ...(subject ? { [ports.subjectField]: subject } : {}) });
    },
    /** The app came to the front, or anything else worth another try. */
    retry: reportAll,
  };
}
