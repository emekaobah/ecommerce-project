import { CollectFrom, EmailLayout, Paragraph, PickupCode, ShopOrder, type EmailCollectionPlace, type EmailShopOrder } from "./parts"

export type ReadyForPickupProps = {
  currency: string
  order: EmailShopOrder
  /** The code to show at the counter (#12). */
  code: string
  place: EmailCollectionPlace
  /** When the hold ends, as `collectByLabel` gives it; null while the shop is paused with no date to reopen. */
  collect_by: string | null
}

/** Sent with the Ready for pickup push (#33): the code, where and when to collect, and by when. */
export function ReadyForPickupEmail({ currency, order, code, place, collect_by }: Readonly<ReadyForPickupProps>) {
  return (
    <EmailLayout preview={`Your pickup code: ${code}`} heading={`Your order from ${order.shop} is ready for pickup`}>
      <Paragraph>{"Show this code at the counter. Whoever has it can collect your order."}</Paragraph>
      <PickupCode code={code} />
      {collect_by && <Paragraph>{`${collect_by}.`}</Paragraph>}
      <CollectFrom place={place} />
      <ShopOrder order={order} currency={currency} />
    </EmailLayout>
  )
}
