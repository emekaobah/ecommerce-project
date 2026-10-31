import { formatMoney, PRODUCT_NAME } from "@oja/domain"
import { Body, Column, Container, Head, Heading, Hr, Html, Preview, Row, Section, Text } from "@react-email/components"
import type { ReactNode } from "react"

// What the buyer emails share (#5), in the apps' monochrome look (docs/design.md): black ink,
// grey secondary text and dividers.

export const INK = "#000000"
export const SECONDARY = "#545454"
export const DIVIDER = "#E2E2E2"
const FONT = "Manrope, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"

/** Body text. */
export const text = { color: INK, fontSize: "15px", lineHeight: "22px", margin: "0" }
const secondary = { ...text, color: SECONDARY, fontSize: "13px", lineHeight: "20px" }

/** One line of a shop's order. */
export type EmailLine = { id: string; title: string; variant: string | null; quantity: number; total: number }

/**
 * One shop's order in a buyer email, named by its shop: the buyer knows the whole checkout by
 * one number (`orderNumber`, #97), not each shop's order by its own.
 */
export type EmailShopOrder = {
  /** Its order's id: shop names aren't unique, so an email keys its shops by this. */
  id: string
  shop: string
  lines: EmailLine[]
  /** Its delivery fee; null for an order collected in store (#12). */
  delivery: number | null
  /** What the buyer paid for it. */
  paid: number
}

/** `footer` goes under the closing line, e.g. an unsubscribe link. */
export function EmailLayout({
  preview,
  heading,
  children,
  footer,
}: Readonly<{ preview: string; heading: string; children: ReactNode; footer?: ReactNode }>) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: "#FFFFFF", fontFamily: FONT, margin: "0", padding: "24px 0" }}>
        <Container style={{ maxWidth: "560px", padding: "0 16px" }}>
          <Text style={{ ...text, fontSize: "20px", fontWeight: 800 }}>{PRODUCT_NAME}</Text>
          <Heading as="h1" style={{ color: INK, fontSize: "26px", lineHeight: "32px", fontWeight: 800, margin: "24px 0 8px" }}>
            {heading}
          </Heading>
          {children}
          <Hr style={{ borderColor: DIVIDER, margin: "32px 0 16px" }} />
          <Text style={secondary}>{`Open the ${PRODUCT_NAME} app to follow your orders.`}</Text>
          {footer}
        </Container>
      </Body>
    </Html>
  )
}

export const Paragraph = ({ children }: Readonly<{ children: ReactNode }>) => <Text style={{ ...text, margin: "0 0 12px" }}>{children}</Text>

export const Note = ({ children }: Readonly<{ children: ReactNode }>) => <Text style={{ ...secondary, margin: "4px 0 0" }}>{children}</Text>

/** A label and an amount, right-aligned. */
export function AmountRow({ label, amount, strong = false }: Readonly<{ label: string; amount: string; strong?: boolean }>) {
  const style = { ...text, fontWeight: strong ? 800 : 400 }
  return (
    <Row>
      <Column style={style}>{label}</Column>
      <Column style={{ ...style, textAlign: "right" }}>{amount}</Column>
    </Row>
  )
}

/** A shop's order: its lines, delivery (none when collected) and what was paid; `children` say more under its heading. */
export function ShopOrder({ order, currency, children }: Readonly<{ order: EmailShopOrder; currency: string; children?: ReactNode }>) {
  const money = (amount: number) => formatMoney(amount, currency)
  return (
    <Section style={{ marginTop: "24px" }}>
      <Hr style={{ borderColor: DIVIDER, margin: "0 0 16px" }} />
      <Text style={{ ...text, fontWeight: 800 }}>{order.shop}</Text>
      {children}
      <Section style={{ marginTop: "12px" }}>
        {order.lines.map((line) => (
          <AmountRow key={line.id} label={`${line.quantity} × ${lineName(line)}`} amount={money(line.total)} />
        ))}
        {order.delivery != null && <AmountRow label="Delivery" amount={money(order.delivery)} />}
        <AmountRow label="Paid" amount={money(order.paid)} strong />
      </Section>
    </Section>
  )
}

/** A line's product, with its variant when that says more than the title. */
const lineName = (line: EmailLine) =>
  line.variant && line.variant !== line.title ? line.title + " (" + line.variant + ")" : line.title

/** The delivery address, one line each. */
export function Address({ lines }: Readonly<{ lines: string[] }>) {
  return (
    <Section style={{ marginTop: "24px" }}>
      <Text style={{ ...text, fontWeight: 800 }}>Delivering to</Text>
      {lines.map((line) => (
        <Text key={line} style={secondary}>
          {line}
        </Text>
      ))}
    </Section>
  )
}

/** Where to collect a pickup order (#12): the collection point's address, the shop's word on it, and its hours. */
export type EmailCollectionPlace = { address: string[]; instructions: string | null; phone: string | null; hours: string[] }

/** Where and when to collect a pickup order. */
export function CollectFrom({ place }: Readonly<{ place: EmailCollectionPlace }>) {
  return (
    <Section style={{ marginTop: "24px" }}>
      <Text style={{ ...text, fontWeight: 800 }}>Collect from</Text>
      {place.address.map((line) => (
        <Text key={line} style={secondary}>
          {line}
        </Text>
      ))}
      {place.instructions && <Text style={{ ...secondary, marginTop: "8px" }}>{place.instructions}</Text>}
      {place.phone && <Text style={secondary}>{`Phone: ${place.phone}`}</Text>}
      {place.hours.length > 0 && (
        <>
          <Text style={{ ...text, fontWeight: 800, marginTop: "16px" }}>Opening hours</Text>
          {place.hours.map((line) => (
            <Text key={line} style={secondary}>
              {line}
            </Text>
          ))}
        </>
      )}
    </Section>
  )
}

/** The code a pickup order is collected with, large, to show at the counter. */
export function PickupCode({ code }: Readonly<{ code: string }>) {
  return (
    <Section style={{ marginTop: "16px" }}>
      <Text style={secondary}>Your pickup code</Text>
      <Text style={{ ...text, fontSize: "32px", lineHeight: "40px", fontWeight: 800, letterSpacing: "6px" }}>{code}</Text>
    </Section>
  )
}

/** Lines of an order, each with how many of it, without amounts: what a notice names. */
export function ItemList({ items }: Readonly<{ items: { title: string; quantity: number }[] }>) {
  return (
    <Section style={{ margin: "4px 0 12px" }}>
      {items.map((item) => (
        <Text key={item.title} style={secondary}>
          {`${item.quantity} × ${item.title}`}
        </Text>
      ))}
    </Section>
  )
}
