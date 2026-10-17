import { createHmac, randomUUID } from "node:crypto"
import { createServer, type IncomingMessage, type Server } from "node:http"

/**
 * A courier the fake quotes: its price, and how many hours after the request it delivers, or
 * at a set time of day `arrives.day` days after the request's day in Lagos. A request for a
 * later `pickup_date` counts from 9am that day instead.
 */
export type FakeCourier = {
  courier_id: string
  courier_name: string
  service_code: string
  amount: number
  hours: number
  tracking_level: number
  arrives?: { day: number; at: string }
}

/**
 * The fake's couriers. Bike is the cheapest and Express the fastest; Next day, arriving within a
 * day of Express for little more than Bike, is the best value. Best value costs what the flat
 * delivery did, so a checkout that keeps it totals as before.
 */
export const COURIERS = {
  bike: { courier_id: "dellyman", courier_name: "Dellyman Bike", service_code: "dellyman", amount: 1800, hours: 60, tracking_level: 6 },
  express: { courier_id: "kwik", courier_name: "Kwik Express", service_code: "kwik", amount: 4200, hours: 5, tracking_level: 8 },
  nextDay: { courier_id: "gig", courier_name: "GIG Next Day", service_code: "gig", amount: 2500, hours: 26, tracking_level: 7 },
  slow: { courier_id: "routely", courier_name: "Routely Standard", service_code: "routely", amount: 3000, hours: 96, tracking_level: 5 },
} satisfies Record<string, FakeCourier>

/**
 * Shipbubble's package categories as the sandbox lists them (GET /shipping/labels/categories,
 * checked 2026-10-04). The ids belong to the account, so the backend looks them up by name.
 */
export const CATEGORIES = [
  { category_id: 2178251, category: "Groceries" },
  { category_id: 77179563, category: "Electronics and gadgets" },
  { category_id: 74794423, category: "Fashion wears" },
  { category_id: 20754594, category: "Light weight items" },
  { category_id: 98190590, category: "Hot food" },
]
export const categoryId = (name: string) => CATEGORIES.find((c) => c.category === name)!.category_id

/** How Shipbubble refuses a request when the account's wallet is empty: a 400, like a bad address. */
const WALLET_EMPTY =
  "Insufficient wallet balance, Please fund your wallet to validate new addresses, or use already validated addresses to continue your tests"

/** What a shop's delivery costs when the buyer keeps the preselected best value. */
export const BEST_VALUE_FEE = COURIERS.nextDay.amount

type Validation = { name: string; email: string; phone: string; address: string; latitude?: number; longitude?: number }
type RateRequest = {
  sender_address_code: number
  reciever_address_code: number
  pickup_date: string
  category_id: number
  package_items: { name: string; description: string; unit_weight: string; unit_amount: string; quantity: string }[]
  package_dimension: { length: number; width: number; height: number }
}
type LabelRequest = { request_token: string; service_code: string; courier_id: string }

/** Shipbubble's shipment statuses, as its webhooks report them. */
export type ShipmentStatus = "pending" | "confirmed" | "picked_up" | "in_transit" | "completed" | "cancelled"

/** A shipment the fake booked: Shipbubble's id for it (`SB-…`), the courier, and where it is. */
export type FakeShipment = { order_id: string; courier: FakeCourier; status: ShipmentStatus; tracking_url: string }

/** "yyyy-mm-dd HH:mm:ss" in Lagos time, as Shipbubble writes ETAs. */
const lagosTime = (at: Date) => new Date(at.getTime() + 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ")

/** When couriers collect a parcel picked up on a later day than today, Lagos time. */
export const LATER_PICKUP_TIME = "09:00:00"

/** "yyyy-mm-dd HH:mm:ss" in Lagos time, `day` days after `now`'s day in Lagos, at `at` (HH:mm:ss). */
export const lagosDayAt = (now: Date, day: number, at: string) => {
  const date = new Date(`${lagosTime(now).slice(0, 10)}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + day)
  return `${date.toISOString().slice(0, 10)} ${at}`
}

/**
 * Stands in for Shipbubble's API: the backend's `SHIPBUBBLE_API_URL` points here. It validates
 * addresses into address codes and quotes `COURIERS` (or `setCouriers`) for any parcel, and
 * records every request for tests to inspect.
 */
export function fakeShipbubble(port: number) {
  const apiKey = `sb_sandbox_${randomUUID().replaceAll("-", "")}`
  const validations: Validation[] = []
  const rateRequests: RateRequest[] = []
  const codes = new Map<string, number>()
  /** The couriers each rate request quoted, by its request token. */
  const quotedBy = new Map<string, FakeCourier[]>()
  const labelRequests: LabelRequest[] = []
  const shipments = new Map<string, FakeShipment>()
  const cancellations: string[] = []
  let labelsFailWith: { status: number; message: string } | undefined
  let couriers: FakeCourier[] = Object.values(COURIERS)
  let rejected: ((v: Validation) => boolean) | undefined
  let ratesFailWith: number | undefined
  let laterPickupsRefused = false
  let walletEmpty = false
  let server: Server | undefined

  const readBody = async (req: IncomingMessage) => {
    let raw = ""
    for await (const chunk of req) raw += chunk
    return raw ? JSON.parse(raw) : {}
  }

  type Reply = { status: number; body: Record<string, unknown> }
  const ok = (data: unknown): Reply => ({ status: 200, body: { status: "success", message: "Retrieved successfully", data } })
  const failed = (status: number, message: string, errors?: string[]): Reply => ({
    status,
    body: { status: "failed", message, ...(errors ? { errors } : {}) },
  })

  const validate = async (req: IncomingMessage): Promise<Reply> => {
    const body = (await readBody(req)) as Validation
    validations.push(body)
    if (!body.name || !body.email || !body.phone || !body.address) {
      return failed(422, "Invalid request parameters", ["Recipient address is required"])
    }
    if (walletEmpty) return failed(400, WALLET_EMPTY)
    if (rejected?.(body)) return failed(400, "Address could not be validated, kindly provide a more descriptive address")
    // Coordinates win over the text, as Shipbubble's do.
    const key = body.latitude != null ? `${body.latitude},${body.longitude}` : body.address
    const code = codes.get(key) ?? 10_000_000 + codes.size
    codes.set(key, code)
    return ok({
      name: body.name,
      email: body.email,
      phone: body.phone,
      formatted_address: `${body.address}, Nigeria`,
      country: "Nigeria",
      country_code: "NG",
      state: "Lagos",
      city: "Lagos",
      latitude: body.latitude ?? 6.45,
      longitude: body.longitude ?? 3.4,
      address_code: code,
    })
  }

  const fetchRates = async (req: IncomingMessage): Promise<Reply> => {
    const body = (await readBody(req)) as RateRequest
    rateRequests.push(body)
    if (ratesFailWith) return failed(ratesFailWith, "Rate request refused")
    if (walletEmpty) return failed(400, WALLET_EMPTY)
    if (![...codes.values()].includes(body.sender_address_code) || ![...codes.values()].includes(body.reciever_address_code)) {
      return failed(400, "Invalid address code")
    }
    const today = lagosTime(new Date()).slice(0, 10)
    if (body.pickup_date > today && laterPickupsRefused) {
      return failed(422, "Invalid request parameters", ["The pickup date must be today"])
    }
    // Counted from the pickup: now, or the morning of a later pickup date.
    const now = body.pickup_date > today ? new Date(`${body.pickup_date}T${LATER_PICKUP_TIME}+01:00`) : new Date()
    const quoted = couriers.map((c) => ({
      courier_id: c.courier_id,
      courier_name: c.courier_name,
      courier_image: null,
      service_code: c.service_code,
      service_type: "pickup",
      tracking_level: c.tracking_level,
      rate_card_amount: c.amount,
      rate_card_currency: "NGN",
      currency: "NGN",
      total: c.amount,
      pickup_eta_time: lagosTime(now),
      delivery_eta: `Within ${c.hours} hrs`,
      delivery_eta_time: c.arrives
        ? lagosDayAt(now, c.arrives.day, c.arrives.at)
        : lagosTime(new Date(now.getTime() + c.hours * 60 * 60 * 1000)),
    }))
    const request_token = `token_${randomUUID()}`
    quotedBy.set(request_token, couriers)
    return ok({ request_token, couriers: quoted })
  }

  // Books a label with a courier one of its rate requests quoted, paid from the wallet.
  const createLabel = async (req: IncomingMessage): Promise<Reply> => {
    const body = (await readBody(req)) as LabelRequest
    labelRequests.push(body)
    if (labelsFailWith) return failed(labelsFailWith.status, labelsFailWith.message)
    if (walletEmpty) return failed(400, WALLET_EMPTY)
    const courier = quotedBy
      .get(body.request_token)
      ?.find((c) => c.courier_id === body.courier_id && c.service_code === body.service_code)
    if (!courier) return failed(422, "Invalid request token or courier")
    const order_id = `SB-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`
    const shipment: FakeShipment = {
      order_id,
      courier,
      status: "pending",
      tracking_url: `https://shipbubble.test/orders/tracking/${order_id}`,
    }
    shipments.set(order_id, shipment)
    return ok({
      order_id,
      courier: { name: courier.courier_name, email: "courier@shipbubble.test", phone: "08000000000" },
      status: "pending",
      payment: { shipping_fee: courier.amount, type: "wallet", status: "completed", currency: "NGN" },
      tracking_url: shipment.tracking_url,
      date: lagosTime(new Date()),
    })
  }

  // Cancels a shipment no courier has collected yet.
  const cancelLabel = (req: IncomingMessage): Reply => {
    const id = decodeURIComponent(req.url!.slice("/shipping/labels/cancel/".length))
    const shipment = shipments.get(id)
    if (!shipment) return failed(404, "Shipment not found")
    if (shipment.status !== "pending" && shipment.status !== "confirmed") return failed(400, "Shipment label already processed")
    cancellations.push(id)
    shipment.status = "cancelled"
    return { status: 200, body: { status: "success", message: "Shipment successfully cancelled" } }
  }

  const routes: [string, string, (req: IncomingMessage) => Reply | Promise<Reply>][] = [
    ["POST", "/shipping/address/validate", validate],
    ["POST", "/shipping/fetch_rates", fetchRates],
    ["GET", "/shipping/labels/categories", () => Promise.resolve(ok(CATEGORIES))],
    ["POST", "/shipping/labels", createLabel],
    // A trailing slash takes the rest of the path as the parameter.
    ["POST", "/shipping/labels/cancel/", cancelLabel],
  ]

  const handle = async (req: IncomingMessage): Promise<Reply> => {
    if (req.headers.authorization !== `Bearer ${apiKey}`) return failed(401, "Invalid API key")
    const route = routes.find(
      ([method, path]) => req.method === method && (path.endsWith("/") ? req.url!.startsWith(path) : req.url === path)
    )
    return route ? route[2](req) : failed(404, "Not found")
  }

  /** Signs a body as Shipbubble does: HMAC-SHA512 with the API key, hex. Another key forges it. */
  const sign = (body: string, key = apiKey) => createHmac("sha512", key).update(body).digest("hex")

  /**
   * A webhook as Shipbubble sends it about a shipment, signed in `x-ship-signature`. The
   * shipment takes the status.
   */
  const webhook = (orderId: string, status: ShipmentStatus, { event }: { event?: string } = {}) => {
    const shipment = shipments.get(orderId)
    if (shipment) shipment.status = status
    const body = JSON.stringify({
      event: event ?? (status === "cancelled" ? "shipment.cancelled" : "shipment.status.changed"),
      order_id: orderId,
      status,
      courier: {
        name: shipment?.courier.courier_name ?? "Courier",
        email: "courier@shipbubble.test",
        phone: "08000000000",
        tracking_code: "2232",
        tracking_message: "Tracking code: 2232",
        rider_info: null,
      },
      tracking_url: shipment?.tracking_url ?? `https://shipbubble.test/orders/tracking/${orderId}`,
      waybill_document: null,
      date: new Date().toISOString(),
    })
    return { body, headers: { "content-type": "application/json", "x-ship-signature": sign(body) } }
  }

  return {
    apiKey,
    apiUrl: `http://127.0.0.1:${port}`,
    start: () =>
      new Promise<void>((resolve) => {
        server = createServer((req, res) => {
          void handle(req).then(({ status, body }) => {
            res.writeHead(status, { "content-type": "application/json" })
            res.end(JSON.stringify(body))
          })
        })
        server.listen(port, "127.0.0.1", resolve)
      }),
    stop: () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
    /** Every address validation asked for, oldest first. */
    validations: () => [...validations],
    /** Every rate request, oldest first. */
    rateRequests: () => [...rateRequests],
    /** The address code Shipbubble gave an address validated by these coordinates or text. */
    codeOf: (key: string) => codes.get(key),
    /** Couriers quoted from now on (default `COURIERS`). */
    setCouriers: (next: FakeCourier[]) => {
      couriers = next
    },
    /** Addresses matching this are refused from now on; undefined clears it. */
    rejectAddresses: (matches: ((v: Validation) => boolean) | undefined) => {
      rejected = matches
    },
    /** Rate requests are answered with this HTTP status from now on; undefined clears it. */
    failRatesWith: (status: number | undefined) => {
      ratesFailWith = status
    },
    /** Rate requests for a `pickup_date` after today are refused (422) from now on, until turned off. */
    refuseLaterPickups: (refused: boolean) => {
      laterPickupsRefused = refused
    },
    /** Every request is refused as Shipbubble does when the wallet is empty, until turned off. */
    emptyWallet: (empty: boolean) => {
      walletEmpty = empty
    },
    /** Every label booking asked for, oldest first. */
    labelRequests: () => [...labelRequests],
    /** The shipment the fake booked under this id. */
    shipment: (orderId: string) => shipments.get(orderId),
    /** The ids of the shipments cancelled through the API, oldest first. */
    cancellations: () => [...cancellations],
    /** Label bookings are refused like this from now on; undefined clears it. */
    failLabelsWith: (failure: { status: number; message: string } | undefined) => {
      labelsFailWith = failure
    },
    webhook,
    sign,
    reset: () => {
      labelsFailWith = undefined
      labelRequests.length = 0
      cancellations.length = 0
      walletEmpty = false
      ratesFailWith = undefined
      laterPickupsRefused = false
      validations.length = 0
      rateRequests.length = 0
      couriers = Object.values(COURIERS)
      rejected = undefined
    },
  }
}
