import type { InferClientOutput } from "@mercurjs/client"
import type { client } from "../../lib/client"

export type Onboarding = InferClientOutput<typeof client.vendor.onboarding.query>["onboarding"]
export type Bank = InferClientOutput<typeof client.vendor.onboarding.banks.query>["banks"][number]

/** Where the checklist is cached; the go-live banner reads it too. */
export const ONBOARDING_QUERY_KEY = ["onboarding"]
