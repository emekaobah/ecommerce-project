import type { InferClientOutput } from "@mercurjs/client"
import { useQuery } from "@tanstack/react-query"
import { client } from "../../lib/client"

export type Onboarding = InferClientOutput<typeof client.vendor.onboarding.query>["onboarding"]
export type Bank = InferClientOutput<typeof client.vendor.onboarding.banks.query>["banks"][number]

/** Where the checklist is cached; the go-live banner reads it too. */
export const ONBOARDING_QUERY_KEY = ["onboarding"]

/** The shop's onboarding checklist, shared by the Shop setup page and the go-live banner. */
export const useOnboarding = () =>
  useQuery<Onboarding>({
    queryKey: ONBOARDING_QUERY_KEY,
    queryFn: async () => (await client.vendor.onboarding.query()).onboarding,
  })
