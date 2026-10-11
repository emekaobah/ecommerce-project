import { render, toPlainText } from "@react-email/components"
import type { ReactElement } from "react"

/** A table cell of `AmountRow`: its label and amount read "Delivery NGN 2,500.00" as text, not run together. */
const COLUMN = { selector: "td[data-id=__react-email-column]", format: "inlineSurround", options: { suffix: " " } }

/** An email's HTML, and the plain text sent alongside it. */
export async function renderEmail(email: ReactElement): Promise<{ html: string; text: string }> {
  const html = await render(email)
  return { html, text: toPlainText(html, { selectors: [COLUMN] }) }
}
