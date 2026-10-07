import { model } from "@medusajs/framework/utils"

/** Who a device's pushes are for: a buyer (customer) or a shop member. */
export const PUSH_TOKEN_ACTORS = ["customer", "member"] as const
export type PushTokenActor = (typeof PUSH_TOKEN_ACTORS)[number]

/**
 * A device's Expo push token and who is signed in on it (#27). A device belongs to one person
 * at a time: registering it again for someone else moves it to them.
 */
const PushToken = model
  .define("push_token", {
    id: model.id({ prefix: "ptok" }).primaryKey(),
    token: model.text().unique(),
    actor_type: model.enum([...PUSH_TOKEN_ACTORS]),
    /** The customer or member id. */
    actor_id: model.text(),
  })
  .indexes([{ on: ["actor_type", "actor_id"] }])

export default PushToken
