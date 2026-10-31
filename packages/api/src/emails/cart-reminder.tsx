import { cartReminderPush, formatMoney, type CartReminderContent } from "@oja/domain"
import { Button, Hr, Link, Section, Text } from "@react-email/components"
import { AmountRow, EmailLayout, Note, Paragraph } from "./parts"

export type CartReminderProps = {
  content: CartReminderContent
  /** The buyer app's Cart tab. */
  cartLink: string
  /** The signed link that turns these emails off. */
  unsubscribeLink: string
}

/**
 * Reminds the buyer of the cart they left (#139): what the push says (shops, top items, good
 * news), then the items they can buy now, shop by shop, and what they cost today before
 * delivery, with a button that opens the cart in the app. It never carries a discount.
 */
export function CartReminderEmail({ content, cartLink, unsubscribeLink }: Readonly<CartReminderProps>) {
  const push = cartReminderPush(content)
  const money = (amount: number) => formatMoney(amount, content.currency_code)
  return (
    <EmailLayout
      preview={push.body}
      heading={push.title}
      footer={
        <Note>
          {"Don't want these reminders? "}
          <Link href={unsubscribeLink} style={{ color: "#545454", textDecoration: "underline" }}>
            Unsubscribe
          </Link>
        </Note>
      }
    >
      <Paragraph>{push.body}</Paragraph>
      {content.shops.map((shop) => (
        <Section key={shop} style={{ marginTop: "16px" }}>
          <Hr style={{ borderColor: "#E2E2E2", margin: "0 0 12px" }} />
          <Text style={{ color: "#000000", fontSize: "15px", lineHeight: "22px", margin: "0 0 4px", fontWeight: 800 }}>{shop}</Text>
          {content.items
            .filter((item) => item.shop === shop)
            .map((item) => (
              <AmountRow key={item.line_item_id} label={`${item.quantity} × ${item.title}`} amount={money(item.total)} />
            ))}
        </Section>
      ))}
      <Section style={{ margin: "16px 0 24px" }}>
        <Hr style={{ borderColor: "#E2E2E2", margin: "0 0 12px" }} />
        <AmountRow label="Total today" amount={money(content.total)} strong />
        <Note>Before delivery.</Note>
      </Section>
      <Button
        href={cartLink}
        style={{ backgroundColor: "#000000", color: "#FFFFFF", borderRadius: "999px", padding: "12px 20px", fontWeight: 700, fontSize: "15px" }}
      >
        Open your cart
      </Button>
    </EmailLayout>
  )
}
