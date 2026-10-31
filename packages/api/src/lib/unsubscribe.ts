import { createHmac, timingSafeEqual } from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { setNotificationPreferences, type NotificationPreferenceKey } from "./notification-preferences"

// Unsubscribe links (#139). An email a buyer can turn off carries a link that turns it off
// without signing in: `<MERCUR_BACKEND_URL>/unsubscribe/<channel>.<customer id>.<signature>`, where the
// signature is an HMAC-SHA256 of the channel and the customer id under `UNSUBSCRIBE_SECRET`
// (base64url). So a link only turns off its own buyer's own channel, and can't be guessed or
// altered to turn off another. The link is the same each time, so an old email's link still works.

type Scope = Pick<MedusaContainer, "resolve">

/** The settings an emailed unsubscribe link can turn off. */
export const UNSUBSCRIBABLE: readonly NotificationPreferenceKey[] = ["cart_reminder_email"]

/** Where the backend is reached from outside, for links in emails: `MERCUR_BACKEND_URL` (the API's public origin), else the local server. */
const backendUrl = (env: NodeJS.ProcessEnv) => (env.MERCUR_BACKEND_URL?.trim() || "http://localhost:9000").replace(/\/+$/, "")

/** The secret unsubscribe links are signed with, or null when `UNSUBSCRIBE_SECRET` isn't set. */
const secretOf = (env: NodeJS.ProcessEnv) => env.UNSUBSCRIBE_SECRET?.trim() || null

const signature = (secret: string, channel: string, customerId: string) =>
  createHmac("sha256", secret).update(`${channel}:${customerId}`).digest("base64url")

/**
 * The link that turns `channel` off for the buyer, or null when no signing secret is set (an
 * email that needs one then isn't sent).
 */
export function unsubscribeLink(customerId: string, channel: NotificationPreferenceKey, env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = secretOf(env)
  if (!secret) return null
  return `${backendUrl(env)}/unsubscribe/${channel}.${customerId}.${signature(secret, channel, customerId)}`
}

/** What a genuine unsubscribe link turns off. */
export type Unsubscribe = { customer_id: string; channel: NotificationPreferenceKey }

/** What the token of an unsubscribe link turns off, or null when it isn't one this backend signed. */
export function readUnsubscribeToken(token: string, env: NodeJS.ProcessEnv = process.env): Unsubscribe | null {
  const secret = secretOf(env)
  const parts = token.split(".")
  if (!secret || parts.length !== 3) return null
  const [channel, customerId, given] = parts as [string, string, string]
  if (!UNSUBSCRIBABLE.includes(channel as NotificationPreferenceKey) || !customerId) return null
  const expected = Buffer.from(signature(secret, channel, customerId))
  const actual = Buffer.from(given)
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  return { customer_id: customerId, channel: channel as NotificationPreferenceKey }
}

/**
 * Turns off what an unsubscribe link names, for a buyer who still exists. False when the link
 * isn't genuine or its buyer is gone, and nothing changes.
 */
export async function unsubscribe(scope: Scope, token: string): Promise<boolean> {
  const link = readUnsubscribeToken(token)
  if (!link) return false
  const [customer] = await scope.resolve(Modules.CUSTOMER).listCustomers({ id: link.customer_id }, { select: ["id"] })
  if (!customer) return false
  await setNotificationPreferences(scope, link.customer_id, { [link.channel]: false })
  return true
}
