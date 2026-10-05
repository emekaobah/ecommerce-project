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
}

/** A made-up Expo push token, as `getExpoPushTokenAsync` returns on a device. */
export const pushToken = () => `ExponentPushToken[${randomUUID().slice(0, 22)}]`

/**
 * Stands in for Expo's push service: the backend's `EXPO_PUSH_API_URL` points here. It accepts
 * every message for a token it hasn't been told is gone, answers with a ticket as Expo does,
 * and records each message for tests to inspect.
 */
export function fakeExpoPush(port: number) {
  const accessToken = `expo_${randomUUID().replaceAll("-", "")}`
  const messages: PushMessage[] = []
  const unregistered = new Set<string>()
  let server: Server | undefined

  const readBody = async (req: IncomingMessage) => {
    let raw = ""
    for await (const chunk of req) raw += chunk
    return raw ? JSON.parse(raw) : {}
  }

  const send = async (req: IncomingMessage) => {
    if (req.headers.authorization !== `Bearer ${accessToken}`) {
      return { status: 401, body: { errors: [{ code: "UNAUTHORIZED", message: "Invalid access token" }] } }
    }
    const body = (await readBody(req)) as PushMessage | PushMessage[]
    const batch = Array.isArray(body) ? body : [body]
    messages.push(...batch)
    const tickets = batch.map((m) =>
      unregistered.has(m.to)
        ? {
            status: "error",
            message: `"${m.to}" is not a registered push notification recipient`,
            details: { error: "DeviceNotRegistered", expoPushToken: m.to },
          }
        : { status: "ok", id: randomUUID() }
    )
    return { status: 200, body: { data: Array.isArray(body) ? tickets : tickets[0] } }
  }

  return {
    accessToken,
    apiUrl: `http://127.0.0.1:${port}`,
    start: () =>
      new Promise<void>((resolve) => {
        server = createServer((req, res) => {
          const reply =
            req.method === "POST" && req.url === "/push/send"
              ? send(req)
              : Promise.resolve({ status: 404, body: { errors: [{ code: "NOT_FOUND" }] } })
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
    reset: () => {
      messages.length = 0
      unregistered.clear()
    },
  }
}
