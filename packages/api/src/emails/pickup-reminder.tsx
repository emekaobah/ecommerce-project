import { PRODUCT_NAME, type HoldReminder } from "@oja/domain"
import { CollectFrom, EmailLayout, Note, Paragraph, type EmailCollectionPlace } from "./parts"

export type PickupReminderProps = {
  number: string
  shop: string
  reminder: HoldReminder
  /** When the hold ends, as `collectByLabel` gives it. */
  collect_by: string
  /** Whether the order has fresh items, which aren't refunded if it isn't collected. */
  perishable: boolean
  place: EmailCollectionPlace
}

/** Sent half-way through a pickup order's hold and on its last day (#33), with a push. */
export function PickupReminderEmail({ number, shop, reminder, collect_by, perishable, place }: Readonly<PickupReminderProps>) {
  const heading = reminder === "last_day" ? `Last day to collect order ${number}` : `Order ${number} is waiting for you`
  return (
    <EmailLayout preview={`${collect_by} from ${shop}`} heading={heading}>
      <Paragraph>{`${collect_by} from ${shop}. Your pickup code is in the ${PRODUCT_NAME} app.`}</Paragraph>
      <Note>
        {perishable
          ? "If it isn't collected in time, it is refunded, except its fresh items."
          : "If it isn't collected in time, it is refunded instead."}
      </Note>
      <CollectFrom place={place} />
    </EmailLayout>
  )
}
