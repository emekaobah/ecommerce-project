import { formatMoney, type RefundAccountReminder, type RefundNotice } from "@oja/domain"
import { Button } from "@react-email/components"
import { EmailLayout, Note, Paragraph } from "./parts"

export type RefundAccountProps = {
  refund: RefundNotice
  /** The buyer app's screen for the refund, where they add the account. */
  link: string
  reminder?: RefundAccountReminder
}

/**
 * Sent when Paystack couldn't return a refund to the buyer's card and needs their bank account
 * to retry it (#13), and as a reminder after 1 and 3 days. The account is added in the app.
 */
export function RefundAccountEmail({ refund: { display_id, shop, amount, currency_code }, link, reminder }: Readonly<RefundAccountProps>) {
  const refund = formatMoney(amount, currency_code)
  const days = reminder && (reminder.days_left === 1 ? "1 day" : `${reminder.days_left} days`)
  return (
    <EmailLayout preview={`Add a bank account to receive your ${refund} refund`} heading={`Your refund for order #${display_id}`}>
      <Paragraph>{`Your bank couldn't take the ${refund} refund for your order from ${shop} back to your card.`}</Paragraph>
      <Paragraph>{"Add a bank account in the app and we'll send it there. It can be anyone's account: you'll see the name on it before it's sent."}</Paragraph>
      <Button
        href={link}
        style={{ backgroundColor: "#000000", color: "#FFFFFF", borderRadius: "999px", padding: "12px 20px", fontWeight: 700, fontSize: "15px" }}
      >
        Add a bank account
      </Button>
      {days ? <Note>{`If you don't within ${days}, our team will contact you to send it another way.`}</Note> : null}
    </EmailLayout>
  )
}
