import { defineWidgetConfig } from "@mercurjs/dashboard-sdk"
import type { InferClientOutput } from "@mercurjs/client"
import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { client } from "../lib/client"

type Payout = InferClientOutput<typeof client.vendor.orders.$id.payout.query>["payout"]

const money = (amount: number, currency: string) => `${currency.toUpperCase()} ${amount.toLocaleString()}`

const STATE_COLORS: Record<Payout["state"], "grey" | "orange" | "blue" | "green" | "red"> = {
  not_due: "grey",
  waiting_for_refund: "orange",
  due: "blue",
  retrying: "orange",
  pending: "blue",
  processing: "blue",
  paid: "green",
  failed: "red",
  canceled: "red",
}

// What the shop is paid for this order (#29): what the buyer paid, less the delivery fee Oja
// keeps, any refunds and Oja's commission, and where the payout is. Members who can't see the
// shop's payouts (fulfilment staff) get a 403, and the widget shows nothing.
const OrderPayoutWidget = ({ data }: { data?: { id: string; updated_at?: string | Date | null } }) => {
  const { t } = useTranslation()
  const orderId = data?.id
  const { data: payout } = useQuery<Payout>({
    queryKey: ["order-payout", orderId, String(data?.updated_at ?? "")],
    queryFn: async () => (await client.vendor.orders.$id.payout.query({ $id: orderId! })).payout,
    enabled: !!orderId,
    retry: false,
  })
  if (!payout) return null
  const { currency_code: currency } = payout
  const line = (label: string, amount: number, sign = "") => (
    <div className="flex items-center justify-between">
      <Text size="small" className="text-ui-fg-subtle">
        {label}
      </Text>
      <Text size="small">
        {sign}
        {money(amount, currency)}
      </Text>
    </div>
  )

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">{t("orderPayout.title")}</Heading>
        <Badge size="2xsmall" color={STATE_COLORS[payout.state]}>
          {t(`orderPayout.states.${payout.state}`)}
        </Badge>
      </div>
      <div className="flex flex-col gap-y-2 px-6 py-4">
        {line(t("orderPayout.paid"), payout.paid)}
        {line(t("orderPayout.delivery"), payout.delivery, "− ")}
        {payout.refunded > 0 && line(t("orderPayout.refunded"), payout.refunded, "− ")}
        {line(t("orderPayout.commission", { percent: payout.commission_percent }), payout.commission, "− ")}
        <div className="flex items-center justify-between">
          <Text size="small" weight="plus">
            {t("orderPayout.amount")}
          </Text>
          <Text size="small" weight="plus">
            {money(payout.amount, currency)}
          </Text>
        </div>
        {payout.recovered !== null && payout.recovered !== 0 && (
          <>
            {line(t("orderPayout.recovered"), payout.recovered, "− ")}
            {payout.transferred !== null && line(t("orderPayout.transferred"), payout.transferred)}
          </>
        )}
      </div>
    </Container>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- the dashboard SDK reads the zone from this export
export const config = defineWidgetConfig({
  zone: "orders.detail.side.before",
})

export default OrderPayoutWidget
