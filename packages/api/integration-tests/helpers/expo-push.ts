import { randomUUID } from "node:crypto"
import { createServer, type IncomingMessage, type Server } from "node:http"

/** A push message as the backend asks Expo to deliver it. */
export type PushMessage = {
  to: string
  title?: string
  body?: string
  data?: Record<string, unknown>
  sound?: string
  priority?: string
  /** The Android notification channel it is shown on. */
  channelId?: string
  /** How it interrupts on iOS, e.g. `time-sensitive` to break through Focus. */
  interruptionLevel?: string
}

/** A made-up Expo push token, as `getExpoPushTokenAsync` returns on a device. */
export const pushToken = () => `ExponentPushToken[${randomUUID().slice(0, 22)}]`

const DEVICE_NOT_REGISTERED = (token: string) => ({
  status: "error",
  message: `"${token}" is not a registered push notification recipient`,
  details: { error: "DeviceNotRegistered", expoPushToken: token },
})

/**
 * Stands in for Expo's push service: the backend's `EXPO_PUSH_API_URL` points here. It accepts
 * every message for a token it hasn't been told is gone, answers with a ticket as Expo does,
 * and records each message for tests to inspect. Asked for the receipts of its tickets, it
 * reports the messages to a device uninstalled after they were sent as never delivered.
 */
export function fakeExpoPush(port: number) {
  const accessToken = `expo_${randomUUID().replaceAll("-", "")}`
  const messages: PushMessage[] = []
  const unregistered = new Set<string>()
  const uninstalledAfterSend = new Set<string>()
  /** The token each accepted ticket was for. */
  const tickets = new Map<string, string>()
  let server: Server | undefined

  const readBody = async (req: IncomingMessage) => {
    let raw = ""
    for await (const chunk of req) raw += chunk
    return raw ? JSON.parse(raw) : {}
  }

  const unauthorized = (req: IncomingMessage) =>
    req.headers.authorization === `Bearer ${accessToken}`
      ? null
      : { status: 401, body: { errors: [{ code: "UNAUTHORIZED", message: "Invalid access token" }] } }

  const send = async (req: IncomingMessage) => {
    const refused = unauthorized(req)
    if (refused) return refused
    const body = (await readBody(req)) as PushMessage | PushMessage[]
    const batch = Array.isArray(body) ? body : [body]
    messages.push(...batch)
    const replies = batch.map((m) => {
      if (unregistered.has(m.to)) return DEVICE_NOT_REGISTERED(m.to)
      const id = randomUUID()
      tickets.set(id, m.to)
      return { status: "ok", id }
    })
    return { status: 200, body: { data: Array.isArray(body) ? replies : replies[0] } }
  }

  const receipts = async (req: IncomingMessage) => {
    const refused = unauthorized(req)
    if (refused) return refused
    const { ids } = (await readBody(req)) as { ids?: string[] }
    const data: Record<string, unknown> = {}
    for (const id of ids ?? []) {
      const token = tickets.get(id)
      if (token) data[id] = uninstalledAfterSend.has(token) ? DEVICE_NOT_REGISTERED(token) : { status: "ok" }
    }
    return { status: 200, body: { data } }
  }

  const routes: Record<string, (req: IncomingMessage) => Promise<{ status: number; body: unknown }>> = {
    "/push/send": send,
    "/push/getReceipts": receipts,
  }

  return {
    accessToken,
    apiUrl: `http://127.0.0.1:${port}`,
    start: () =>
      new Promise<void>((resolve) => {
        server = createServer((req, res) => {
          const route = req.method === "POST" ? routes[req.url ?? ""] : undefined
          const reply = route ? route(req) : Promise.resolve({ status: 404, body: { errors: [{ code: "NOT_FOUND" }] } })
          void reply.then(({ status, body }) => {
            res.writeHead(status, { "content-type": "application/json" })
            res.end(JSON.stringify(body))
          })
        })
        server.listen(port, "127.0.0.1", resolve)
      }),
    stop: () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
    /** Every message sent to this token, oldest first. */
    sentTo: (token: string) => messages.filter((m) => m.to === token),
    /** Every message sent, oldest first. */
    messages: () => [...messages],
    /** Expo answers messages to this token with DeviceNotRegistered, as for an uninstalled app. */
    uninstall: (token: string) => {
      unregistered.add(token)
    },
    /**
     * Expo accepts messages to this token, then reports in their receipts that the device is
     * gone: the app was uninstalled after Expo last heard from it.
     */
    uninstallAfterSend: (token: string) => {
      uninstalledAfterSend.add(token)
    },
    reset: () => {
      messages.length = 0
      unregistered.clear()
      uninstalledAfterSend.clear()
      tickets.clear()
    },
  }
}
