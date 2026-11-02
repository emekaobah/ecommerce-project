# 17. Live Activity pushes go straight to Apple

Status: accepted, 2026-11-01

## Context

#133 shows a buyer's shop order, and a shop's stage counts, on the Lock Screen and in the Dynamic Island. The server starts, updates and ends those Live Activities by push.

ADR 0008 sends every push through Medusa's notification module and our Expo provider. That can't carry these:

- Expo's push service doesn't send Live Activity pushes, and Expo's own guide sends them straight to Apple.
- They need the `liveactivity` push type, a `<bundle id>.push-type.liveactivity` topic, a chosen priority, and an `aps` payload with `event` and `content-state`. A notification's title and body don't describe that.
- They are addressed by APNs tokens that iOS issues per activity, not by the device's Expo push token.

The device test (#140, iPhone 17 on iOS 27.0.1, `expo-widgets@58.0.26`, APNs sandbox) had to settle whether the Expo widgets library can do this at all. It can: an activity started by push-to-start with the app closed reported its update token to the backend within about 3 seconds, and an update push to that token changed the activity. So iOS stays on `expo-widgets`, not hand-written SwiftUI. It also found:

- The first push-started activity shows iOS's Allow prompt. Until the buyer answers, no update token arrives, so a missing token doesn't mean a failure.
- A 200 from Apple means it accepted the push, not that the phone showed it. An update to an activity that had gone returned 200.
- `content-state` has to be the library's envelope, `{"name":"<factory>","props":"<JSON string>"}`. Apple accepts fields at the top level too, but the activity never updates.
- An `end` push shows its `content-state` until `dismissal-date`, so it carries the real final state.

"Don't Allow", production builds and token rotation weren't tested.

Android has no equivalent of this push, and stays on Expo: see ADR 0019. This ADR is about iOS only.

## Decision

Live Activity pushes sit outside the notification module and outside Expo. `src/modules/live-activity-push` sends them to Apple over HTTP/2, signed with a .p8 key.

- **`send` is the whole interface.** A caller says which app, token, environment and priority, the event, the content and any alert. It answers `sent`, `token_rejected`, `failed` or `not_configured`, and never throws.
- **The module doesn't know who a token belongs to.** Callers work out who to tell, pick the priority and forget a `token_rejected` token (a 410, or `BadDeviceToken`). As in ADR 0008, the sender can't reach the token storage, because module isolation keeps them apart.
- **The token's recorded environment picks the host**, so test builds and store builds never cross over.
- **The signing token is cached for 50 minutes.** Apple refuses one older than an hour and throttles refreshing more often than every 20 minutes. Connections stay open and are reused, as Apple asks.
- **With no key it logs and sends nothing**, so a developer needs no Apple key to run the backend.
- **A `failed` ending is tried again.** The caller keeps the activity unended (a buyer's with the final state it tried to show, in `end_content`, for the `retry-buyer-activity-endings` job; a shop's by the minute job, since it's still closed) until Apple takes it, or until the 12 hours iOS gives an activity have passed and nothing is left to end. A dead token Apple keeps answering `failed` for can't be tried for ever.

## Consequences

- Never route these through the notification module or Expo. Nothing would reach the activity.
- These pushes get no notification rows. ADR 0008's record of what was sent, and its idempotency keys, don't apply, so callers must not rely on either. Failures are in the logs.
- Normal order pushes still go through ADR 0008, and they are the fallback when an activity gets no token or a 200 reaches nothing.
- Each server and worker process holds its own signing token and connections.
- Sending takes one more secret on the host, set by hand and never committed: the .p8 key.
