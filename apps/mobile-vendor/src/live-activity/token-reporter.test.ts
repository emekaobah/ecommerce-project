import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { tokenReporter, type PostResult, type TokenReporterPorts } from './token-reporter';

type Session = { token: string };
const SESSION: Session = { token: 'member' };

function phone(heldKey: string | null = null) {
  let key = heldKey;
  const ports = {
    readKey: mock(async () => key),
    saveKey: mock(async (next: string) => {
      key = next;
    }),
    clearKey: mock(async () => {
      key = null;
    }),
    register: mock(async (held: string | null) => held ?? 'issued-key'),
    remove: mock(async (_key: string, _session: Session) => {}),
    post: mock(async (): Promise<PostResult> => 'ok'),
  } satisfies TokenReporterPorts<Session>;
  return { ports, reporter: tokenReporter(ports), key: () => key };
}

describe('tokenReporter', () => {
  let device: ReturnType<typeof phone>;
  beforeEach(() => {
    device = phone();
  });

  test('a token that arrives before the phone has a key waits for sign-in', async () => {
    device.reporter.pushToStartToken('start-1');
    await device.reporter.idle();
    expect(device.ports.post).not.toHaveBeenCalled();

    device.reporter.signedIn();
    await device.reporter.idle();

    expect(device.key()).toBe('issued-key');
    expect(device.ports.post).toHaveBeenCalledWith('issued-key', { kind: 'push_to_start', token: 'start-1' });
  });

  test('a phone with a key reports a token straight away, with no session', async () => {
    device = phone('held-key');
    device.reporter.activityToken('a1', 'update-1');
    await device.reporter.idle();

    expect(device.ports.register).not.toHaveBeenCalled();
    expect(device.ports.post).toHaveBeenCalledWith('held-key', { kind: 'activity', activity_id: 'a1', token: 'update-1' });
  });

  test('a report names the shop the activity is for', async () => {
    device = phone('held-key');
    device.reporter.activityToken('a1', 'update-1', 'sel_1');
    await device.reporter.idle();

    expect(device.ports.post).toHaveBeenCalledWith('held-key', { kind: 'activity', activity_id: 'a1', token: 'update-1', seller_id: 'sel_1' });
  });

  test('a report that failed is sent again on the next try, and not after it worked', async () => {
    device = phone('held-key');
    device.ports.post.mockImplementationOnce(async () => 'failed');
    device.reporter.activityToken('a1', 'update-1');
    await device.reporter.idle();

    device.reporter.retry();
    await device.reporter.idle();
    device.reporter.retry();
    await device.reporter.idle();

    expect(device.ports.post).toHaveBeenCalledTimes(2);
  });

  test('a key the server no longer knows is dropped', async () => {
    device = phone('old-key');
    device.ports.post.mockImplementationOnce(async () => 'revoked');
    device.reporter.pushToStartToken('start-1');
    await device.reporter.idle();

    expect(device.key()).toBeNull();
  });

  test('sign-out forgets the phone with the session as it was, after what is under way', async () => {
    device.reporter.signedIn();
    await device.reporter.signingOut(SESSION);

    expect(device.ports.remove).toHaveBeenCalledWith('issued-key', SESSION);
    expect(device.key()).toBeNull();
  });

  test('sign-out drops the key even if the server can\'t be told', async () => {
    device = phone('held-key');
    device.ports.remove.mockImplementationOnce(async () => {
      throw new Error('offline');
    });
    await device.reporter.signingOut(SESSION);

    expect(device.key()).toBeNull();
  });

  test('the next member to sign in sends the push-to-start token again', async () => {
    device = phone('held-key');
    device.reporter.pushToStartToken('start-1');
    await device.reporter.signingOut(SESSION);
    device.ports.post.mockClear();

    device.reporter.signedIn();
    await device.reporter.idle();

    expect(device.ports.post).toHaveBeenCalledWith('issued-key', { kind: 'push_to_start', token: 'start-1' });
  });

  describe('the switch', () => {
    test('has no key to read with until the phone has one', async () => {
      expect(await device.reporter.currentKey()).toBeNull();
    });

    test('gets the phone a key to save with, once', async () => {
      expect(await device.reporter.ensureKey()).toBe('issued-key');
      expect(await device.reporter.ensureKey()).toBe('issued-key');
      expect(device.ports.register).toHaveBeenCalledTimes(1);
    });

    test('fails when the phone can\'t get a key, and later steps still run', async () => {
      device.ports.register.mockImplementationOnce(async () => {
        throw new Error('offline');
      });
      await expect(device.reporter.ensureKey()).rejects.toThrow('offline');
      expect(await device.reporter.ensureKey()).toBe('issued-key');
    });
  });
});
