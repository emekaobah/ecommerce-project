import { formatMoney, orderNumber } from "@oja/domain"
import { Section } from "@react-email/components"
import { Address, AmountRow, EmailLayout, Paragraph, ShopOrder, type EmailShopOrder } from "./parts"

export type DeliveryReceiptProps = {
  /** The checkout (order group) the shop's order was part of, as the buyer app numbers it. */
  group_display_id: number
  currency: string
  order: EmailShopOrder
  /** What has been refunded of the order (items the shop didn't have); 0 when nothing was. */
  refunded: number
  /** When it was delivered, as the buyer reads it. */
  delivered_on: string
  address: string[]
}

/** Sent when a shop's order is delivered (#5): the buyer's receipt for it. */
export function DeliveryReceiptEmail({ group_display_id, currency, order, refunded, delivered_on, address }: Readonly<DeliveryReceiptProps>) {
  return (
    <EmailLayout preview={`Your receipt for your order from ${order.shop}`} heading={`Your order from ${order.shop} was delivered`}>
      <Paragraph>{`It arrived on ${delivered_on}. Here is your receipt for this part of order ${orderNumber(group_display_id)}.`}</Paragraph>
      <ShopOrder order={order} currency={currency} />
      {refunded > 0 && (
        <Section>
          <AmountRow label="Refunded" amount={formatMoney(-refunded, currency)} />
          <AmountRow label="You paid" amount={formatMoney(order.paid - refunded, currency)} strong />
        </Section>
      )}
      <Address lines={address} />
    </EmailLayout>
  )
}
