import { model } from "@medusajs/framework/utils"
import { APNS_ENVIRONMENTS, LIVE_ACTIVITY_KINDS } from "./constants"
import LiveActivityDevice from "./live-activity-device"

/**
 * One activity on one phone. A server start records it before the phone has said anything;
 * `apple_id` and `token` arrive when the phone reports them, and may never (ADR 0017).
 */
const LiveActivity = model
  .define("live_activity", {
    id: model.id({ prefix: "lact" }).primaryKey(),
    device: model.belongsTo(() => LiveActivityDevice, { mappedBy: "activities" }),
    kind: model.enum([...LIVE_ACTIVITY_KINDS]),
    /** The shop order or the seller it is about. Null for a reported activity the phone can't name. */
    subject_id: model.text().nullable(),
    /** ActivityKit's id, as `LiveActivity.getId()` gives it. */
    apple_id: model.text().nullable(),
    /** Its update token. */
    token: model.text().nullable(),
    /** What Apple last accepted for this phone, and when: what the shop's batched updates compare against (#147). */
    sent_content: model.json().nullable(),
    sent_at: model.dateTime().nullable(),
    environment: model.enum([...APNS_ENVIRONMENTS]),
    started_at: model.dateTime(),
    ended_at: model.dateTime().nullable(),
  })
  .indexes([
    // One running activity per subject per phone, however often the event arrives.
    { on: ["device_id", "kind", "subject_id"], unique: true, where: "ended_at IS NULL AND subject_id IS NOT NULL" },
    { on: ["apple_id"], unique: true, where: "apple_id IS NOT NULL" },
    { on: ["token"], unique: true, where: "token IS NOT NULL" },
  ])

export default LiveActivity
