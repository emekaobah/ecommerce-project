import { MedusaError } from "@medusajs/framework/utils"

export const EXPO_PUSH_API_URL = "https://exp.host/--/api/v2"

/** Expo's error for a token whose app is no longer installed: pushes to it never arrive again. */
export const DEVICE_NOT_REGISTERED = "DeviceNotRegistered"

/** Expo takes at most this many receipt ids per request. */
const RECEIPTS_PER_REQUEST = 1000

export type ExpoPushOptions = {
  /** Needed only once the Expo project turns on enhanced push security. */
  accessToken?: string
  apiUrl?: string
}

/**
 * How a push rings when it shouldn't sound like any other: a sound bundled in the app (iOS plays
 * it by file name; Android plays the channel's), the Android channel it is shown on, and its iOS
 * interruption level. Passed as the notification's `provider_data`.
 */
export type ExpoPushAlert = {
  sound: string
  channelId: string
  interruptionLevel: "time-sensitive"
}

export type ExpoPushMessage = {
  to: string
  title?: string
  body?: string
  data: Record<string, unknown>
  sound: string
  priority: "high"
  channelId?: string
  interruptionLevel?: ExpoPushAlert["interruptionLevel"]
}

type ExpoError = { status: "error"; message: string; details?: { error?: string } }

/** Expo's answer for one message: accepted with a ticket id, or refused (e.g. `DeviceNotRegistered`). */
export type ExpoTicket = { status: "ok"; id: string } | ExpoError

/** Whether Expo delivered an accepted message, asked for by its ticket id once it has tried. */
export type ExpoReceipt = { status: "ok" } | ExpoError

/** The Expo error code of a refused ticket or receipt, or its message when it has none. */
export const expoError = (answer: ExpoError) => answer.details?.error ?? answer.message

/** Where Expo push is, as the backend is configured: the same variables `medusa-config` passes the provider. */
export const expoPushOptionsFromEnv = (): ExpoPushOptions => ({
  accessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
  apiUrl: process.env.EXPO_PUSH_API_URL || undefined,
})

/** Expo's push service: sending a message, and later asking whether it was delivered. */
export function expoPushApi({ accessToken, apiUrl = EXPO_PUSH_API_URL }: ExpoPushOptions) {
  const post = async <T>(path: string, payload: unknown): Promise<T> => {
    const res = await fetch(`${apiUrl}${path}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(payload),
    })
    const reply = (await res.json().catch(() => null)) as { data?: T; errors?: { message?: string }[] } | null
    if (!res.ok || !reply?.data) {
      const reason = reply?.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Expo push refused ${path}: ${reason}`)
    }
    return reply.data
  }

  return {
    /** Expo's ticket for one message. */
    send: async (message: ExpoPushMessage): Promise<ExpoTicket> => {
      const [ticket] = await post<ExpoTicket[]>("/push/send", [message])
      if (!ticket) throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Expo push answered without a ticket")
      return ticket
    },
    /** The receipts Expo has for these tickets, by ticket id. Tickets it has none for yet are left out. */
    receipts: async (ticketIds: string[]): Promise<Record<string, ExpoReceipt>> => {
      const batches: string[][] = []
      for (let i = 0; i < ticketIds.length; i += RECEIPTS_PER_REQUEST) batches.push(ticketIds.slice(i, i + RECEIPTS_PER_REQUEST))
      const answers = await Promise.all(batches.map((ids) => post<Record<string, ExpoReceipt>>("/push/getReceipts", { ids })))
      return Object.assign({}, ...answers)
    },
  }
}
