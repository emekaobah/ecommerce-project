# 18. A phone reports Live Activity tokens with its own key, not a session

Status: accepted, 2026-11-01

## Context

iOS hands an app its Live Activity tokens whenever it likes, including on a background launch with the app closed (#140). That launch runs only the root layout's imports. No screen mounts, Clerk may not have restored a session, and the phone may be locked, where a default keychain item (Clerk's session among them) can't be read. An activity's update token has to reach the backend then, or the server can't update the activity until the buyer next opens the app.

So the POST can't need a session, but a token must still reach only its own buyer. ADR 0008's routes tie a token to whoever's session posted it, which doesn't work here.

Options considered:

- **Hold tokens until a session exists.** Simple, but an update token would wait until the app is next opened, which defeats the activity.
- **Accept tokens from anyone, with an id the app makes up, and tie that id to a buyer at sign-in.** Unauthenticated writes create rows for anyone who asks.
- **Sign in during the background launch.** Depends on a locked keychain and a network round trip to Clerk within iOS's few seconds.

## Decision

The server gives a signed-in phone a key, and the phone reports tokens with it.

- `POST /store/live-activity-devices`, with the buyer's session, issues 32 random bytes and stores only their SHA-256. The app keeps the key in the keychain with `AFTER_FIRST_UNLOCK`, so a background launch can read it on a locked phone.
- `POST /store/live-activity-tokens` takes the key alone, in the `x-live-activity-key` header. No key, or one the server doesn't know, is a 401. A token that arrives before the phone has a key waits in memory until sign-in. Nothing is lost: iOS sends the tokens again on later launches.
- `DELETE /store/live-activity-devices/current`, with the session and the key, removes the phone and its tokens at sign-out, only if it is still this buyer's. The key then stops working, so a token post that arrives hours late (#140) can't bring the phone back.
- A phone belongs to one person, as in ADR 0008. Signing in with a key moves the phone to that buyer. A sign-out that never reached the server leaves a stale row, and the phone's tokens move off it when they are next reported.
- The app posts with the key using plain `fetch`, not the store client, whose 401 would sign the buyer out.

The device row links to the phone's Expo push token by value, because module isolation keeps it apart from `push_token`. A phone can have one without the other, since notifications and Live Activities are separate permissions.

## Consequences

- No write reaches a buyer's data without a key that a signed-in session issued, and every key can be revoked.
- The key is a long-lived bearer credential. Someone who took it from the phone's keychain could point that phone's activities at another device, and activities carry order details and pickup codes. It grants nothing else, and signing out ends it.
- A phone must be signed in once before a token can reach the backend. The app must already have been opened once for iOS to issue a push-to-start token (#140), so this adds no new wait.
- The vendor app (#146) uses the same routes' shape with a member's session, at `/vendor/live-activity-devices`, and reports tokens with the key at `/vendor/live-activity-tokens`, which opts out of Mercur's member auth (`AUTHENTICATE = false`).
- For the vendor's shop activity, an update token goes to the phone's only activity still waiting for one. A phone waiting on two shops' at once can't tell them apart, so that token isn't guessed: nothing ends those activities early and iOS ends them at its 8-hour limit. Only a phone on two shops whose first orders land in the same moment, or before iOS's Allow prompt is answered, hits this.
- JS can't read which activity is which: `expo-widgets` exposes only ActivityKit's id. A server-started activity's update token therefore arrives with no shop order attached. Only the activities an older iPhone starts itself name their order. #144 has to solve this before it can update an activity.
