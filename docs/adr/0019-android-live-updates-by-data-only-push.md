# 19. Android Live Updates are drawn by the phone from data-only pushes

Status: accepted, 2026-11-01

## Context

#133 gives Android the same order progress as an iPhone's Live Activity (ADR 0017): an Android 16 Live Update, and an ongoing notification on older versions, for a buyer's shop order and a shop's stage counts (#148, #149).

Facts that shaped the decision (checked 2026-10-31):

- Android has no push that changes a notification on the server's behalf. The app has to post it.
- Android forbids custom views in a Live Update. So the Expo widgets library's Android notifications can't be used, and Live Updates draw only what a standard notification can.
- Expo's push service can deliver a message with no title or body to an `expo-notifications` background task. Doze can delay it, so it can't be the only way a buyer hears of a step.

## Decision

- **The same content goes to both.** The backend builds the content of ADR 0017's Apple pushes (`@oja/domain`) and sends it in a data-only Expo push, on the notification module's `push` channel (ADR 0008). The phone's background task turns it into a `LiveUpdateView` and `packages/expo-live-update`, a small Kotlin module, posts it.
- **The rules are the same as iOS's.** A start, update and end happen at the same moments, under the same switch, and normal pushes all still go. An order the switch ended stays ended, and one accepted with the switch off never shows.
- **What each phone should be showing is recorded, as on iOS.** A buyer's Android phone has a `buyer_live_update` row per order, by its Expo token: a buyer's phone needs no key, since it reports nothing. A member's Android phone has a `live_activity` row per shop with no Apple token, on the device row the switch needs. Both rows are what later messages are sent by.
- **A message is told once per event (ADR 0008).** Its idempotency key comes from the event: a state and when it was reached, the order that was new or nearing its deadline, the row that started or ended, or the last update a batched one follows. A row is removed from a phone once, so its removal needs nothing else. `revision`, the server's time when sent, is in the message and not in the key, so a late message can't undo a newer one.
- **A message Expo refused is sent again.** The row stays running, and the next event about that order or shop tries again under the same key if nothing has changed. There's no retry job as there is for iOS's endings: a notification still goes by itself at its timeout.

## Consequences

- iOS's 8-hour limit doesn't apply, so there's no restart on Android. A notification times out at 12 hours, as long as iOS keeps an activity, so one whose last message never arrived can't stay for ever.
- Android has no "Don't Allow" question for these, and no alert stands in for a push. Nothing replaces the accepted push on Android.
- A phone only draws a Live Update if it said it's Android when it registered its push token (`push_token.platform`). An older build, which can't draw one, is sent none.
- A phone needs FCM credentials (`google-services.json`) to get a push token at all. Without them nothing here reaches it.
