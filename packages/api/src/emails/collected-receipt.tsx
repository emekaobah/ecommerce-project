import { formatMoney } from "@oja/domain"
import { Section } from "@react-email/components"
import { AmountRow, EmailLayout, Paragraph, ShopOrder, type EmailShopOrder } from "./parts"

export type CollectedReceiptProps = {
  /** The checkout (order group) the shop's order was part of, as the buyer app numbers it. */
  group_display_id: number
  currency: string
  order: EmailShopOrder
  /** What has been refunded of the order (items the shop didn't have); 0 when nothing was. */
  refunded: number
  /** When it was collected, as the buyer reads it. */
  collected_on: string
  /** The name the collector gave at the counter. */
  collected_by: string
}

/** Sent when a pickup order is collected (#33): the buyer's receipt for it, with a push. */
export function CollectedReceiptEmail({ group_display_id, currency, order, refunded, collected_on, collected_by }: Readonly<CollectedReceiptProps>) {
  return (
    <EmailLayout preview={`Your receipt for your order from ${order.shop}`} heading={`Your order from ${order.shop} was collected`}>
      <Paragraph>{`${collected_by} collected it on ${collected_on}. Here is your receipt for this part of order #${group_display_id}.`}</Paragraph>
      <ShopOrder order={order} currency={currency} />
      {refunded > 0 && (
        <Section>
          <AmountRow label="Refunded" amount={formatMoney(-refunded, currency)} />
          <AmountRow label="You paid" amount={formatMoney(order.paid - refunded, currency)} strong />
        </Section>
      )}
    </EmailLayout>
  )
}
