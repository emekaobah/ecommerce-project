import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

type Scope = Pick<MedusaContainer, "resolve">

/** A notice for Oja's team: its title and description, and a key that sends it once. */
export type OjaTeamNotice = { title: string; description: string; key: string }

/** Tells Oja's team, in the admin's notifications feed (every operator sees it). Sent once per `key`. */
export async function notifyOjaTeam(scope: Scope, { title, description, key }: OjaTeamNotice): Promise<void> {
  await scope.resolve(Modules.NOTIFICATION).createNotifications({
    to: "",
    channel: "feed",
    template: "admin-ui",
    data: { title, description },
    idempotency_key: key,
  })
}
