import { formatMoney, orderNumber, type RemovedItem } from "@oja/domain"
import { EmailLayout, ItemList, Note, Paragraph } from "./parts"

export type NotCollectedProps = {
  group_display_id: number
  shop: string
  /** What the buyer is refunded: its non-perishable lines. */
  refund: number
  currency_code: string
  /** The lines refunded, and the fresh lines that aren't. */
  refunded: RemovedItem[]
  kept: RemovedItem[]
}

/**
 * Sent when a pickup order's hold ends uncollected (#33, #32), with a push: what is refunded,
 * and the fresh items that aren't. It stands for the refund's own "completed" push.
 */
export function NotCollectedEmail({ group_display_id, shop, refund, currency_code, refunded, kept }: Readonly<NotCollectedProps>) {
  return (
    <EmailLayout preview={`${shop} held it, but it wasn't collected in time`} heading={`Order ${orderNumber(group_display_id)} wasn't collected`}>
      <Paragraph>{`${shop} held your order, but it wasn't collected in time.`}</Paragraph>
      {refund > 0 && (
        <>
          <Paragraph>{`You'll be refunded ${formatMoney(refund, currency_code)} for:`}</Paragraph>
          <ItemList items={refunded} />
          <Note>{"It goes back to the card you paid with, and can take a few days to reach you."}</Note>
        </>
      )}
      {kept.length > 0 && (
        <>
          <Paragraph>{"Fresh items aren't refunded once an order isn't collected:"}</Paragraph>
          <ItemList items={kept} />
        </>
      )}
    </EmailLayout>
  )
}
