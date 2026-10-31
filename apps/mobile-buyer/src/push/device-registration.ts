import { type NotificationPermission, shouldAskPushConsent } from './push-consent';

export type DeviceRegistrationPorts = {
  /** Whether the phone has allowed or denied notifications yet, without asking. */
  permission: () => Promise<NotificationPermission>;
  pushesCanArrive: () => boolean;
  /** This device's push token (asking iOS if needed), or null where pushes can't arrive. */
  pushToken: () => Promise<string | null>;
  /** Registers the token for the signed-in buyer's pushes. */
  add: (token: string) => Promise<void>;
  /** Stops the token getting the buyer's pushes. */
  remove: (token: string) => Promise<void>;
  askConsent: () => void;
};

export type DeviceRegistration = {
  registerOrAskConsent: () => void;
  registerAfterConsent: () => void;
  forgetDevice: () => Promise<void>;
};

/**
 * This device's push registration for the signed-in buyer (#27, #136). Every step that leads to a
 * registration is recorded before its first await, so a sign-out at any point waits for it and
 * removes its token; a step that hasn't registered yet when the buyer signs out stops instead.
 */
export function deviceRegistration(ports: DeviceRegistrationPorts): DeviceRegistration {
  /** The device's token once registered for the signed-in buyer; pending while registering. */
  let registered: Promise<string | null> = Promise.resolve(null);
  /** Bumped on sign-out: a step started under an older session must not register. */
  let session = 0;

  async function register(startedIn: number): Promise<string | null> {
    try {
      const pushToken = await ports.pushToken();
      if (!pushToken || startedIn !== session) return null;
      await ports.add(pushToken);
      return pushToken;
    } catch (error) {
      console.warn('Registering for push notifications failed', error);
      return null;
    }
  }

  async function registerOrAsk(startedIn: number): Promise<string | null> {
    let permission;
    try {
      permission = await ports.permission();
    } catch (error) {
      console.warn('Reading the notification permission failed', error);
      return null;
    }
    if (startedIn !== session) return null;
    if (shouldAskPushConsent({ signedIn: true, permission, pushesCanArrive: ports.pushesCanArrive() })) {
      ports.askConsent();
      return null;
    }
    return register(startedIn);
  }

  return {
    /** Registers straight away where the phone has already allowed or denied notifications; otherwise asks first. */
    registerOrAskConsent() {
      registered = registerOrAsk(session);
    },
    /** The buyer continued past the consent screen: iOS's prompt, then registration. */
    registerAfterConsent() {
      registered = register(session);
    },
    /** Before sign-out, while the session still works: stops this device getting the buyer's pushes. */
    async forgetDevice() {
      const pending = registered;
      session += 1;
      registered = Promise.resolve(null);
      const pushToken = await pending;
      if (!pushToken) return;
      try {
        await ports.remove(pushToken);
      } catch (error) {
        // The next buyer to sign in on the device takes it over.
        console.warn('Removing the device from push notifications failed', error);
      }
    },
  };
}
