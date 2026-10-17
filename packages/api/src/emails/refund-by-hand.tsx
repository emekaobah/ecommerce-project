import { formatMoney } from "@oja/domain"
import { EmailLayout, Note, Paragraph } from "./parts"

export type RefundByHandProps = {
  display_id: number
  shop: string
  currency: string
  amount: number
}

/**
 * Sent when a refund Paystack can't make goes to Oja's team (#16): under Paystack's ₦50
 * minimum, or refused on every retry. The team sends it, by bank transfer for example.
 */
export function RefundByHandEmail({ display_id, shop, currency, amount }: Readonly<RefundByHandProps>) {
  const refund = formatMoney(amount, currency)
  return (
    <EmailLayout preview={`Our team is sending your ${refund} refund`} heading={`Your refund for order #${display_id}`}>
      <Paragraph>{`Our team is sending your ${refund} refund for your order from ${shop}.`}</Paragraph>
      <Note>{"We couldn't return it to your card automatically, so we'll send it another way and contact you if we need your details."}</Note>
    </EmailLayout>
  )
}
