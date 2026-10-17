import { notPlacedChangeMessage, notPlacedMessage, type NotPlaced, type NotPlacedChange } from "@oja/domain"
import { EmailLayout, Note, Paragraph } from "./parts"

export type CheckoutNotPlacedProps = { not_placed: NotPlaced; currency: string; changes: NotPlacedChange[] }

/** Sent when a buyer paid but their cart failed to become orders, and was refunded in full (#38). */
export function CheckoutNotPlacedEmail({ not_placed, currency, changes }: Readonly<CheckoutNotPlacedProps>) {
  const message = notPlacedMessage(not_placed, currency)
  return (
    <EmailLayout preview={message} heading="Your order wasn't placed">
      <Paragraph>{message}</Paragraph>
      <Paragraph>A refund can take a few days to reach your card, depending on your bank.</Paragraph>
      {changes.length > 0 && <Paragraph>We&apos;ve updated your cart so you can order again:</Paragraph>}
      {changes.map((change) => (
        <Note key={notPlacedChangeMessage(change)}>{notPlacedChangeMessage(change)}</Note>
      ))}
    </EmailLayout>
  )
}
