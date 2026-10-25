import { formatMoney, preparedWhenOpen } from "@oja/domain"
import { Section } from "@react-email/components"
import { Address, AmountRow, EmailLayout, Note, Paragraph, ShopOrder, type EmailShopOrder } from "./parts"

export type OrderConfirmationProps = {
  /** The checkout's number (`orderNumber`, "OJ-12"): the buyer's number for the whole order, as the app shows it. */
  number: string
  currency: string
  /** Each shop's order; `opens` is when a shop closed at checkout opens again, e.g. "8am Tue". */
  orders: (EmailShopOrder & { opens: string | null })[]
  address: string[]
}

/** Sent once a checkout is paid and split into an order per shop (#5). */
export function OrderConfirmationEmail({ number, currency, orders, address }: Readonly<OrderConfirmationProps>) {
  const total = orders.reduce((sum, o) => sum + o.paid, 0)
  const sentTo =
    orders.length === 1
      ? `We've sent it to ${orders[0]!.shop}, and we'll let you know as soon as it accepts it.`
      : `We've sent it to ${orders.length} shops, and we'll let you know as soon as each accepts it.`
  return (
    <EmailLayout preview={`Order ${number}: ${formatMoney(total, currency)} paid`} heading={`Order ${number} is confirmed`}>
      <Paragraph>{`Thanks for your order. ${sentTo}`}</Paragraph>
      {orders.map((order) => (
        <ShopOrder key={order.id} order={order} currency={currency}>
          {order.opens && <Note>{preparedWhenOpen({ name: order.shop, opens: order.opens })}</Note>}
        </ShopOrder>
      ))}
      {orders.length > 1 && (
        <Section style={{ marginTop: "16px" }}>
          <AmountRow label="Total paid" amount={formatMoney(total, currency)} strong />
        </Section>
      )}
      <Address lines={address} />
    </EmailLayout>
  )
}
