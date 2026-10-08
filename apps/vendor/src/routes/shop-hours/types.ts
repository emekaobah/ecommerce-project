import type { InferClientOutput } from "@mercurjs/client"
import { useQuery } from "@tanstack/react-query"
import { client } from "../../lib/client"

export type ShopHours = InferClientOutput<typeof client.vendor.shopHours.query>["shop_hours"]

/** Where the shop's hours are cached. */
export const SHOP_HOURS_QUERY_KEY = ["shop-hours"]

export const useShopHours = () =>
  useQuery<ShopHours>({
    queryKey: SHOP_HOURS_QUERY_KEY,
    queryFn: async () => (await client.vendor.shopHours.query()).shop_hours,
  })
