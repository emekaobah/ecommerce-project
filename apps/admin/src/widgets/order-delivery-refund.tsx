import { defineWidgetConfig } from "@mercurjs/dashboard-sdk"
import type { InferClientOutput } from "@mercurjs/client"
import { Button, Container, Heading, Input, Label, Text, toast } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { client } from "../lib/client"

type DeliveryRefund = InferClientOutput<typeof client.admin.orders.$id.deliveryRefund.query>["delivery_refund"]

const money = (amount: number, currency: string) => `${currency.toUpperCase()} ${amount.toLocaleString()}`

// Refunding an order's delivery fee (#22), a late courier say: only Oja's staff may, since Oja
// keeps the fee, so the refund never comes off the shop's payout. At most what is left of the
// fee; left blank, all of it.
const OrderDeliveryRefundWidget = ({ data }: { data?: { id: string; updated_at?: string | Date | null } }) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const orderId = data?.id
  const queryKey = ["order-delivery-refund", orderId, String(data?.updated_at ?? "")]
  const [amount, setAmount] = useState("")
  const { data: refundable, isError } = useQuery<DeliveryRefund>({
    queryKey,
    queryFn: async () => (await client.admin.orders.$id.deliveryRefund.query({ $id: orderId! })).delivery_refund,
    enabled: !!orderId,
  })
  const refund = useMutation({
    mutationFn: async (requested: number | undefined) =>
      (await client.admin.orders.$id.deliveryRefund.mutate({ $id: orderId!, amount: requested })).delivery_refund,
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next)
      // The order's payments and totals changed too.
      void queryClient.invalidateQueries({ queryKey: ["orders"] })
      setAmount("")
      toast.success(t("deliveryRefund.refunded"))
    },
    onError: (error) => toast.error(error.message),
  })
  if (!refundable || refundable.delivery_fee <= 0) {
    return isError ? (
      <Container className="px-6 py-4">
        <Text size="small" className="text-ui-fg-error">
          {t("deliveryRefund.loadError")}
        </Text>
      </Container>
    ) : null
  }
  const { currency_code: currency, left } = refundable
  const requested = amount.trim() === "" ? undefined : Number(amount)
  const invalid = requested !== undefined && (!Number.isFinite(requested) || requested <= 0 || requested > left)

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">{t("deliveryRefund.title")}</Heading>
      </div>
      <div className="flex flex-col gap-y-2 px-6 py-4">
        <div className="flex items-center justify-between">
          <Text size="small" className="text-ui-fg-subtle">
            {t("deliveryRefund.fee")}
          </Text>
          <Text size="small">{money(refundable.delivery_fee, currency)}</Text>
        </div>
        <div className="flex items-center justify-between">
          <Text size="small" weight="plus">
            {t("deliveryRefund.left")}
          </Text>
          <Text size="small" weight="plus">
            {money(left, currency)}
          </Text>
        </div>
        {left > 0 && (
          <>
            <Label htmlFor="delivery-refund-amount" size="small">
              {t("deliveryRefund.amountLabel")}
            </Label>
            <Input
              id="delivery-refund-amount"
              type="number"
              min={0}
              max={left}
              placeholder={String(left)}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <Button
              size="small"
              variant="secondary"
              disabled={invalid || refund.isPending}
              isLoading={refund.isPending}
              onClick={() => refund.mutate(requested)}
            >
              {t("deliveryRefund.refund", { amount: money(requested ?? left, currency) })}
            </Button>
          </>
        )}
        <Text size="small" className="text-ui-fg-subtle">
          {t("deliveryRefund.hint")}
        </Text>
      </div>
    </Container>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- the dashboard SDK reads the zone from this export
export const config = defineWidgetConfig({
  zone: "orders.detail.side.before",
})

export default OrderDeliveryRefundWidget
