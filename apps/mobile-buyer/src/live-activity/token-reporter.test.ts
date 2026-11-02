import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { tokenReporter, type OwedActivity, type PostResult, type TokenReporterPorts } from './token-reporter';

const OLD_ORDER = {
  order_id: 'order_1',
  url: 'oja://order/g1',
  content: { shop: 'Iya Bisi' } as OwedActivity['content'],
};

function fakes(overrides: Partial<TokenReporterPorts> = {}) {
  let storedKey: string | null = null;
  const ports = {
    readKey: mock(async () => storedKey),
    saveKey: mock(async (key: string) => {
      storedKey = key;
    }),
    clearKey: mock(async () => {
      storedKey = null;
    }),
    register: mock(async (key: string | null, _pushToken: string | null) => key ?? 'issued-key'),
    remove: mock(async (_key: string) => {}),
    post: mock(async (_key: string, _report: unknown): Promise<PostResult> => 'ok'),
    owed: mock(async (_key: string): Promise<OwedActivity[]> => []),
    startActivity: mock((_content: OwedActivity['content'], _url: string) => 'activity-started'),
    recordStarted: mock(async (_key: string, _order: string, _activity: string) => {}),
    startsActivitiesItself: () => false,
    endActivities: mock(() => {}),
  } satisfies TokenReporterPorts;
  return { ports: { ...ports, ...overrides } as typeof ports, setKey: (key: string) => (storedKey = key), key: () => storedKey };
}

const settled = async (reporter: ReturnType<typeof tokenReporter>) => reporter.idle();
const pushToStart = { kind: 'push_to_start', token: 'abc' };
const activity = { kind: 'activity', activity_id: 'a1', token: 'def' };

describe('which order an activity is for', () => {
  test('its token is reported with the order its url names, so the server can follow it', async () => {
    const f = fakes();
    f.setKey('held-key');
    const reporter = tokenReporter(f.ports);

    reporter.activityToken('a1', 'def', 'order_1');
    await settled(reporter);

    expect(f.ports.post).toHaveBeenCalledWith('held-key', { ...activity, order_id: 'order_1' });
  });
});

describe('signing out', () => {
  test("ends the activities on the phone: nothing can update them any more, and one may show a pickup code", async () => {
    const f = fakes();
    f.setKey('held-key');
    const reporter = tokenReporter(f.ports);

    await reporter.signingOut();

    expect(f.ports.endActivities).toHaveBeenCalledTimes(1);
  });

  test('still forgets the phone if iOS refuses to end them', async () => {
    const f = fakes({
      endActivities: mock(() => {
        throw new Error('gone');
      }),
    });
    f.setKey('held-key');
    const reporter = tokenReporter(f.ports);

    await reporter.signingOut();

    expect(f.ports.remove).toHaveBeenCalledWith('held-key', undefined);
  });
});

describe('a launch before auth is restored', () => {
  let f: ReturnType<typeof fakes>;
  beforeEach(() => {
    f = fakes();
  });

  test('a phone that already has its key reports a token straight away, with no session', async () => {
    f.setKey('held-key');
    const reporter = tokenReporter(f.ports);

    reporter.pushToStartToken('abc');
    await settled(reporter);

    expect(f.ports.post).toHaveBeenCalledWith('held-key', pushToStart);
    expect(f.ports.register).not.toHaveBeenCalled();
  });

  test('a phone with no key yet holds the token until the buyer signs in, then reports it', async () => {
    const reporter = tokenReporter(f.ports);

    reporter.pushToStartToken('abc');
    reporter.activityToken('a1', 'def');
    await settled(reporter);
    expect(f.ports.post).not.toHaveBeenCalled();

    reporter.signedIn();
    await settled(reporter);

    expect(f.key()).toBe('issued-key');
    expect(f.ports.post).toHaveBeenCalledWith('issued-key', pushToStart);
    expect(f.ports.post).toHaveBeenCalledWith('issued-key', activity);
  });

  test('a keychain that can\'t be read yet just holds the token', async () => {
    const reporter = tokenReporter({
      ...f.ports,
      readKey: async () => {
        throw new Error('locked');
      },
    });

    reporter.pushToStartToken('abc');
    await settled(reporter);

    expect(f.ports.post).not.toHaveBeenCalled();
  });
});

describe('reporting', () => {
  test('a failed post is tried again next time, a sent one isn\'t', async () => {
    const f = fakes();
    f.setKey('k');
    let answer: PostResult = 'failed';
    const post = mock(async () => answer);
    const reporter = tokenReporter({ ...f.ports, post });

    reporter.pushToStartToken('abc');
    await settled(reporter);
    expect(post).toHaveBeenCalledTimes(1);

    answer = 'ok';
    reporter.retry();
    await settled(reporter);
    expect(post).toHaveBeenCalledTimes(2);

    reporter.retry();
    await settled(reporter);
    expect(post).toHaveBeenCalledTimes(2);
  });

  test('a post that throws counts as failed', async () => {
    const f = fakes();
    f.setKey('k');
    const post = mock(async (_key: string, _report: unknown): Promise<PostResult> => {
      throw new Error('offline');
    });
    const reporter = tokenReporter({ ...f.ports, post });

    reporter.pushToStartToken('abc');
    await settled(reporter);
    reporter.signedIn();
    await settled(reporter);

    // Failed, so it's still waiting and goes again.
    expect(post).toHaveBeenCalledTimes(2);
  });

  test('a rotated token replaces the one still waiting', async () => {
    const f = fakes();
    const reporter = tokenReporter(f.ports);

    reporter.pushToStartToken('old');
    reporter.pushToStartToken('new');
    reporter.signedIn();
    await settled(reporter);

    const posted = f.ports.post.mock.calls.map((call: unknown[]) => call[1]);
    expect(posted).toEqual([{ kind: 'push_to_start', token: 'new' }]);
  });

  test('a key the server no longer knows is dropped, and the token waits for the next sign-in', async () => {
    const f = fakes();
    f.setKey('dead');
    let answer: PostResult = 'revoked';
    const reporter = tokenReporter({ ...f.ports, post: async () => answer });

    reporter.pushToStartToken('abc');
    await settled(reporter);
    expect(f.key()).toBeNull();

    answer = 'ok';
    reporter.signedIn();
    await settled(reporter);
    expect(f.key()).toBe('issued-key');
  });
});

describe('signing in', () => {
  test('sends the phone\'s Expo push token once it has one', async () => {
    const f = fakes();
    const reporter = tokenReporter(f.ports);

    reporter.signedIn();
    await settled(reporter);
    reporter.pushTokenRegistered('ExponentPushToken[x]');
    await settled(reporter);

    expect(f.ports.register).toHaveBeenLastCalledWith('issued-key', 'ExponentPushToken[x]');
  });

  test('a phone registered before keeps its key', async () => {
    const f = fakes();
    f.setKey('held-key');
    const reporter = tokenReporter(f.ports);

    reporter.signedIn();
    await settled(reporter);

    expect(f.ports.register).toHaveBeenCalledWith('held-key', null);
  });

  test('an Expo token from before sign-in waits for it', async () => {
    const f = fakes();
    const reporter = tokenReporter(f.ports);

    reporter.pushTokenRegistered('ExponentPushToken[x]');
    await settled(reporter);
    expect(f.ports.register).not.toHaveBeenCalled();

    reporter.signedIn();
    await settled(reporter);
    expect(f.ports.register).toHaveBeenCalledWith(null, 'ExponentPushToken[x]');
  });
});

describe('signing out', () => {
  test('removes the phone with its key, then forgets the key', async () => {
    const f = fakes();
    const reporter = tokenReporter(f.ports);
    reporter.signedIn();
    await settled(reporter);

    await reporter.signingOut();

    expect(f.ports.remove).toHaveBeenCalledWith('issued-key', undefined);
    expect(f.key()).toBeNull();
  });

  test('waits for a registration under way, so it can\'t land after the removal', async () => {
    const f = fakes();
    let finishRegistering = (_key: string) => {};
    const register = mock(() => new Promise<string>((resolve) => (finishRegistering = resolve)));
    const reporter = tokenReporter({ ...f.ports, register });

    reporter.signedIn();
    const out = reporter.signingOut();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.ports.remove).not.toHaveBeenCalled();
    finishRegistering('issued-key');
    await out;

    expect(f.ports.remove).toHaveBeenCalledWith('issued-key', undefined);
    expect(f.key()).toBeNull();
  });

  test('forgets the key even when the server can\'t be reached', async () => {
    const f = fakes();
    f.setKey('k');
    const reporter = tokenReporter({
      ...f.ports,
      remove: async () => {
        throw new Error('offline');
      },
    });

    await reporter.signingOut();

    expect(f.key()).toBeNull();
  });

  test('keeps the push-to-start token for whoever signs in next, as iOS won\'t send it again this launch', async () => {
    const f = fakes();
    f.setKey('k');
    const reporter = tokenReporter(f.ports);
    reporter.pushToStartToken('abc');
    await settled(reporter);
    await reporter.signingOut();
    f.ports.post.mockClear();

    reporter.signedIn();
    await settled(reporter);

    expect(f.ports.post).toHaveBeenCalledWith('issued-key', pushToStart);
  });

  test('doesn\'t pass the last buyer\'s activity tokens on to the next', async () => {
    const f = fakes();
    const reporter = tokenReporter(f.ports);
    reporter.activityToken('a1', 'def');
    await settled(reporter);
    await reporter.signingOut();

    reporter.signedIn();
    await settled(reporter);

    expect(f.ports.post).not.toHaveBeenCalled();
  });
});

describe('older iOS', () => {
  const older = (overrides: Partial<TokenReporterPorts> = {}) => {
    const f = fakes({ startsActivitiesItself: () => true, ...overrides });
    f.ports.owed.mockImplementation(async () => [OLD_ORDER]);
    return f;
  };

  test('starts each owed activity once the buyer is signed in, and says so', async () => {
    const f = older();
    const reporter = tokenReporter(f.ports);

    reporter.signedIn();
    await settled(reporter);

    expect(f.ports.startActivity).toHaveBeenCalledWith(OLD_ORDER.content, OLD_ORDER.url);
    expect(f.ports.recordStarted).toHaveBeenCalledWith('issued-key', 'order_1', 'activity-started');
  });

  test('looks again each time the app comes to the front', async () => {
    const f = older();
    const reporter = tokenReporter(f.ports);
    reporter.signedIn();
    await settled(reporter);
    f.ports.owed.mockClear();

    reporter.retry();
    await settled(reporter);

    expect(f.ports.owed).toHaveBeenCalled();
  });

  test('doesn\'t look before the buyer has signed in this launch: it needs a session', async () => {
    const f = older();
    f.setKey('k');
    const reporter = tokenReporter(f.ports);

    reporter.retry();
    await settled(reporter);

    expect(f.ports.owed).not.toHaveBeenCalled();
  });

  test('a phone with Live Activities off skips the start and tries next time', async () => {
    const f = older({
      startActivity: () => {
        throw new Error('not allowed');
      },
    });
    const reporter = tokenReporter(f.ports);

    reporter.signedIn();
    await settled(reporter);

    expect(f.ports.recordStarted).not.toHaveBeenCalled();
  });

  test('an activity it couldn\'t record isn\'t started a second time, only recorded', async () => {
    let answer = false;
    const recordStarted = mock(async () => {
      if (!answer) throw new Error('offline');
    });
    const f = older({ recordStarted });
    const reporter = tokenReporter(f.ports);
    reporter.signedIn();
    await settled(reporter);

    answer = true;
    reporter.retry();
    await settled(reporter);

    expect(f.ports.startActivity).toHaveBeenCalledTimes(1);
    expect(recordStarted).toHaveBeenCalledTimes(2);
  });

  test('a newer iPhone never starts one itself', async () => {
    const f = fakes();
    f.ports.owed.mockImplementation(async () => [OLD_ORDER]);
    const reporter = tokenReporter(f.ports);

    reporter.signedIn();
    await settled(reporter);

    expect(f.ports.owed).not.toHaveBeenCalled();
  });
});
