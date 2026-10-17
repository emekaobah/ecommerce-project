import { cancelReasonText, formatMoney, type Cancellation } from "@oja/domain"
import { EmailLayout, Note, Paragraph } from "./parts"

export type OrderCancelledProps = {
  display_id: number
  shop: string
  cancellation: Pick<Cancellation, "by" | "reason" | "note">
  /** All that was left of what the buyer paid for the order: their refund. */
  refund: number
  currency_code: string
}

/** Sent when an accepted order is cancelled (#17), by its shop or by Oja's team: why, and what is refunded. */
export function OrderCancelledEmail({ display_id, shop, cancellation, refund, currency_code }: Readonly<OrderCancelledProps>) {
  const who = cancellation.by === "operator" ? `We cancelled your order from ${shop}.` : `${shop} cancelled your order.`
  const amount = formatMoney(refund, currency_code)
  return (
    <EmailLayout preview={who} heading={`Order #${display_id} cancelled`}>
      <Paragraph>{who}</Paragraph>
      <Paragraph>{`Why: ${cancelReasonText(cancellation)}`}</Paragraph>
      {refund > 0 && (
        <>
          <Paragraph>{`You'll be refunded ${amount}.`}</Paragraph>
          <Note>{"It goes back to the card you paid with, and can take a few days to reach you."}</Note>
        </>
      )}
    </EmailLayout>
  )
}
