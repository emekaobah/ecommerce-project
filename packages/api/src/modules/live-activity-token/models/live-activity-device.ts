import { model } from "@medusajs/framework/utils"
import { APNS_ENVIRONMENTS, LIVE_ACTIVITY_ACTORS, LIVE_ACTIVITY_APPS } from "./constants"
import LiveActivity from "./live-activity"

/**
 * One app on one phone, and who is signed in on it (ADR 0018). A device belongs to one person at
 * a time, as its push token does (ADR 0008), and `key_hash` is how it reports tokens on a launch
 * with no session.
 */
const LiveActivityDevice = model
  .define("live_activity_device", {
    id: model.id({ prefix: "ladev" }).primaryKey(),
    app: model.enum([...LIVE_ACTIVITY_APPS]),
    actor_type: model.enum([...LIVE_ACTIVITY_ACTORS]),
    actor_id: model.text(),
    /** The SHA-256 of the key the phone holds. */
    key_hash: model.text().unique(),
    /** The Expo push token of the same phone (`push_token.token`), which says which Expo push a start stands in for. */
    push_token: model.text().nullable(),
    /** Null until iOS issues one, which it doesn't below 17.2 or with Live Activities turned off. */
    push_to_start_token: model.text().nullable(),
    /** Which of Apple's hosts this phone's build uses. */
    environment: model.enum([...APNS_ENVIRONMENTS]),
    /** When the phone last reported any activity's update token: iOS has shown it can run them. */
    update_token_reported_at: model.dateTime().nullable(),
    activities: model.hasMany(() => LiveActivity, { mappedBy: "device" }),
  })
  .indexes([
    { on: ["actor_type", "actor_id"] },
    { on: ["push_to_start_token"], unique: true, where: "push_to_start_token IS NOT NULL" },
    { on: ["push_token"], unique: true, where: "push_token IS NOT NULL" },
  ])
  .cascades({ delete: ["activities"] })

export default LiveActivityDevice
