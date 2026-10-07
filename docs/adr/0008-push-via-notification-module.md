# 8. Push notifications through Medusa's notification module

Status: accepted, 2026-10-06

## Context

#27 pushes shop staff about their orders from the backend: a new order, the accept deadline approaching, a courier pickup booked. Buyer pushes (#28) and the email notifications in the design follow. Both apps are Expo apps, so a device is addressed by its Expo push token and pushes go through Expo's push service.

Facts that shaped the decision (checked 2026-10-06):

- Medusa 2.20's notification module sends each notification through the provider registered for its channel (`email`, `sms`, or any name we choose), and records it: recipient, channel, template, data, status (`pending`, `success`, `failure`) and the provider's `external_id`.
- `createNotifications` skips a notification whose `idempotency_key` it has already sent. One that failed is sent again under the same key.
- Expo's push API answers each message with a ticket: an id, or an error such as `DeviceNotRegistered` when it already knows the app is gone. About 15 minutes later the ticket's receipt says whether the message was delivered, with the same errors. Receipts are kept for a day.
- A device has one Expo push token per app install. Staff share devices, and a buyer may sign in on a phone a shop member used.
- Expo's server SDK only wraps two HTTP calls, so we call the API directly.

## Decision

### Pushes are notifications on a `push` channel

Pushes go through the notification module. We do not build a separate push service. Our provider (`src/modules/expo-push`) is registered for a `push` channel. A notification is one device: `to` is the Expo push token, `content.subject` and `content.text` are the title and body, and `data` is what the app reads when the push is tapped. The notification's `external_id` is Expo's ticket id.

Code that pushes (`src/lib/shop-push.ts`) works out who should be told and which of their devices to use, then calls `createNotifications` once per device. Email will use the same module on the `email` channel, so a status change can be sent to both channels from one place.

### One token per device, owned by whoever registered it last

Tokens live in our own module (`src/modules/push-token`). `token` is unique, and each token has one owner (`actor_type` is customer or member, plus `actor_id`):

- An app registers its token once someone signs in (`POST /store/push-tokens`, `POST /vendor/push-tokens`). If the token already belongs to someone else, it **moves** to whoever registered it. A shared phone gets the pushes of whoever is signed in on it now, never the previous user's.
- Signing out removes the token, but only if it still belongs to the person signing out. Someone else may have signed in on that device since.
- A member's token gets pushes about every shop they belong to. Each push carries `seller_id`, so tapping it opens the order as that shop.
- When Expo reports `DeviceNotRegistered`, on a ticket or a receipt, the token is deleted for everyone. The hourly `check-push-receipts` job reads the receipts of the last hour's accepted pushes.

### Idempotency keys stop duplicate pushes

Every push has an idempotency key `<kind>:<order id>:<device token>`. An event can arrive twice, for example after a subscriber retry or a re-emitted event, and a device is still told only once. Because the key includes the device, a member who registers a new device later can still get a push about the same event on it. A push Expo refused can be retried, since the module resends failed notifications.

## Consequences

- Each push is stored as a notification row with its status and Expo ticket. We can see what was sent and whether it failed without our own log table, and the receipts job finds tickets there.
- Adding a channel (email, SMS) means adding a provider. Code that pushes does not change.
- Sending one notification per device costs one notification-module transaction and one Expo request per device. A shop has a few devices, so this is cheap. It also means a refusal is known to belong to that device. For large fan-outs (marketing pushes) we would batch instead.
- Idempotency depends on the notification module's check, which is not locked (Medusa notes this in its source). Two exactly simultaneous sends of the same event could both go out. We accept that.
- The provider cannot reach the push-token module, because module isolation keeps them apart. So a `DeviceNotRegistered` refusal reaches `shop-push.ts` only as an error message, and it is matched on Expo's error code.
- If Expo cannot be asked for receipts when the job runs, that hour's dead devices are not found from receipts. The next push to such a device gets a `DeviceNotRegistered` ticket and removes it then.
