import { defineWidgetConfig } from "@mercurjs/dashboard-sdk"
import type { InferClientOutput } from "@mercurjs/client"
import { Container, Heading, StatusBadge, Table, Text } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { client } from "../lib/client"

type Checkout = InferClientOutput<typeof client.admin.orders.$id.checkout.query>["checkout"]

const money = (amount: number, currency: string) => `${currency.toUpperCase()} ${amount.toLocaleString()}`

type BadgeColor = "green" | "orange" | "red" | "grey"
const PAYMENT_COLORS: Record<string, BadgeColor> = {
  captured: "green",
  partially_refunded: "orange",
  refunded: "red",
  awaiting: "orange",
  authorized: "orange",
  not_paid: "red",
  canceled: "grey",
}
const FULFILLMENT_COLORS: Record<string, BadgeColor> = {
  not_fulfilled: "grey",
  fulfilled: "green",
  shipped: "green",
  delivered: "green",
  canceled: "grey",
}

// The checkout the order was placed in (#14). A checkout split across shops is one Paystack
// payment: each order shows its own share (Refunded beside Captured when a shop rejected its
// order), and the payment shows as Paystack has it, for reconciling.
const OrderCheckoutWidget = ({ data }: { data?: { id: string; updated_at?: string | Date | null } }) => {
  const { t } = useTranslation()
  const orderId = data?.id
  const { data: checkout, isError } = useQuery<Checkout>({
    queryKey: ["order-checkout", orderId, String(data?.updated_at ?? "")],
    queryFn: async () => (await client.admin.orders.$id.checkout.query({ $id: orderId! })).checkout,
    enabled: !!orderId,
  })
  if (!checkout) {
    return isError ? (
      <Container className="px-6 py-4">
        <Text size="small" className="text-ui-fg-error">
          {t("orderCheckout.loadError")}
        </Text>
      </Container>
    ) : null
  }
  const { currency_code: currency, payment } = checkout
  const paymentStatus = (status: string) => (
    <StatusBadge color={PAYMENT_COLORS[status] ?? "grey"}>
      {t(`orderCheckout.paymentStatus.${status}`, { defaultValue: status })}
    </StatusBadge>
  )

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">{t("orderCheckout.title", { id: checkout.display_id })}</Heading>
      </div>
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>{t("orderCheckout.order")}</Table.HeaderCell>
            <Table.HeaderCell>{t("orderCheckout.shop")}</Table.HeaderCell>
            <Table.HeaderCell>{t("orderCheckout.payment")}</Table.HeaderCell>
            <Table.HeaderCell>{t("orderCheckout.fulfillment")}</Table.HeaderCell>
            <Table.HeaderCell className="text-right">{t("orderCheckout.paid")}</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {checkout.orders.map((order) => (
            <Table.Row key={order.id} className={order.id === orderId ? "bg-ui-bg-highlight" : undefined}>
              <Table.Cell>#{order.display_id}</Table.Cell>
              <Table.Cell>{order.shop ?? "-"}</Table.Cell>
              <Table.Cell>{paymentStatus(order.payment_status)}</Table.Cell>
              <Table.Cell>
                <StatusBadge color={FULFILLMENT_COLORS[order.fulfillment_status] ?? "orange"}>
                  {t(`orderCheckout.fulfillmentStatus.${order.fulfillment_status}`, { defaultValue: order.fulfillment_status })}
                </StatusBadge>
              </Table.Cell>
              <Table.Cell className="text-right">
                {money(order.captured_amount, currency)}
                {order.refunded_amount > 0 && (
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {t("orderCheckout.refunded", { amount: money(order.refunded_amount, currency) })}
                  </Text>
                )}
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
      {payment && (
        <div className="flex flex-col gap-y-2 px-6 py-4">
          <div className="flex items-center justify-between">
            <Text size="small" weight="plus">
              {t("orderCheckout.sharedPayment")}
            </Text>
            {paymentStatus(payment.status)}
          </div>
          <div className="flex items-center justify-between">
            <Text size="small" className="text-ui-fg-subtle">
              {t("orderCheckout.captured")}
            </Text>
            <Text size="small">{money(payment.captured_amount, currency)}</Text>
          </div>
          <div className="flex items-center justify-between">
            <Text size="small" className="text-ui-fg-subtle">
              {t("orderCheckout.totalRefunded")}
            </Text>
            <Text size="small">{money(payment.refunded_amount, currency)}</Text>
          </div>
          {payment.reference && (
            <div className="flex items-center justify-between">
              <Text size="small" className="text-ui-fg-subtle">
                {t("orderCheckout.reference")}
              </Text>
              <Text size="small" className="font-mono">
                {payment.reference}
              </Text>
            </div>
          )}
          <Text size="small" className="text-ui-fg-subtle">
            {t("orderCheckout.hint")}
          </Text>
        </div>
      )}
    </Container>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- the dashboard SDK reads the zone from this export
export const config = defineWidgetConfig({
  zone: "orders.detail.main.after",
})

export default OrderCheckoutWidget
