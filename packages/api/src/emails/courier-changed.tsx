import { EmailLayout, Note, Paragraph } from "./parts"

export type CourierChangedProps = {
  display_id: number
  shop: string
  /** The courier now delivering the order. */
  courier: string
  /** The courier the buyer chose at checkout. */
  chosen: string
  /** When it now arrives, as the buyer reads it: "Arrives tomorrow". */
  arrives: string
}

/** Sent when a shop's order is booked with another courier than the buyer chose at checkout (#19). */
export function CourierChangedEmail({ display_id, shop, courier, chosen, arrives }: Readonly<CourierChangedProps>) {
  const now = `Your order from ${shop} is now shipping with ${courier}.`
  return (
    <EmailLayout preview={now} heading={`New courier for order #${display_id}`}>
      <Paragraph>{now}</Paragraph>
      <Paragraph>{`${arrives}.`}</Paragraph>
      <Note>{`It replaces ${chosen}, the courier you chose at checkout. You won't pay any more for delivery.`}</Note>
    </EmailLayout>
  )
}
