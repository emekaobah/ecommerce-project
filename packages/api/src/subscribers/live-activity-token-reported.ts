import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { catchUpBuyerActivity, endSpareBuyerActivity, LIVE_ACTIVITY_TOKEN_REPORTED, type LiveActivityTokenReported } from "../lib/buyer-live-activity"

/** A phone reported an activity's token: answered first, because a background launch has only seconds (#140), and caught up here (#144). */
export default async function liveActivityTokenReportedHandler({ event, container }: SubscriberArgs<LiveActivityTokenReported>) {
  const { data } = event
  if ("spare" in data) await endSpareBuyerActivity(container, data.spare)
  else await catchUpBuyerActivity(container, data.id)
}

export const config: SubscriberConfig = {
  event: LIVE_ACTIVITY_TOKEN_REPORTED,
  context: { subscriberId: "live-activity-token-reported" },
}
