import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  hoursExceptionErrors,
  isOrderable,
  shopStatus,
  shopStatusLabel,
  weeklyHoursErrors,
  type HoursException,
  type OpenPeriod,
  type ShopHours,
  type ShopStatus,
  type WeeklyHours,
} from "@oja/domain"
import { SHIPBUBBLE_TIMEZONE } from "../modules/shipbubble"
import { SHOP_HOURS_MODULE, type ShopHoursModuleService } from "../modules/shop-hours"
import { pauseInForce } from "../modules/shop-hours/filters"
import {
  createShopHoursExceptionWorkflow,
  deleteShopHoursExceptionWorkflow,
  endShopHoursExceptionWorkflow,
  pauseShopWorkflow,
  resumeShopWorkflow,
  setShopWeeklyHoursWorkflow,
} from "../workflows/shop-hours"
import { ORDER_FULFILMENT_MODULE, type OrderFulfilmentModuleService } from "../modules/order-fulfilment"

// Shop hours and closures (ADR 0004, #68): our module is the only source of truth for when a
// shop is open. Buyers see a shop outside its hours as closed but orderable, and a shop in a
// closed exception or paused as closed until it reopens, not orderable. `@oja/domain` does the
// arithmetic; this reads and writes the module.

type Scope = Pick<MedusaContainer, "resolve">

const shopHoursService = (scope: Scope) => scope.resolve<ShopHoursModuleService>(SHOP_HOURS_MODULE)

/**
 * How far back closures are read for the clocks. Deadlines run from orders a few days old at
 * most; an order still New after this long has long been rejected.
 */
const HISTORY_MS = 60 * 24 * 60 * 60 * 1000

type WeeklyRow = { seller_id: string; weekly: WeeklyHours }
type ExceptionRow = { id: string; seller_id: string; starts_on: string; ends_on: string; closed: boolean; periods: OpenPeriod[]; note: string | null }
type PauseRow = { id: string; seller_id: string; starts_at: Date | string; ends_at: Date | string | null; note: string | null }

const iso = (date: Date | string) => new Date(date).toISOString()

/** Today's date in the timezone, YYYY-MM-DD, as exceptions are kept. */
const todayIn = (timeZone: string, now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(now)

/** Each shop's region's timezone, from its pickup address's country; Lagos when it has none. */
async function timeZonesOf(scope: Scope, sellerIds: string[]): Promise<Map<string, string>> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const [{ data: sellers }, { data: regions }] = await Promise.all([
    query.graph({ entity: "seller", fields: ["id", "address.country_code"], filters: { id: sellerIds } }),
    query.graph({ entity: "region", fields: ["id", "metadata", "countries.iso_2"] }),
  ])
  const zoneOfCountry = new Map<string, string>()
  for (const region of regions as { metadata?: Record<string, unknown> | null; countries?: ({ iso_2: string } | null)[] | null }[]) {
    const zone = region.metadata?.time_zone
    if (typeof zone !== "string" || !zone) continue
    for (const country of region.countries ?? []) if (country) zoneOfCountry.set(country.iso_2.toLowerCase(), zone)
  }
  return new Map(
    (sellers as { id: string; address?: { country_code?: string | null } | null }[]).map((s) => [
      s.id,
      zoneOfCountry.get(s.address?.country_code?.toLowerCase() ?? "") ?? SHIPBUBBLE_TIMEZONE,
    ])
  )
}

/** The hours of each shop that has weekly hours, with recent and coming exceptions and pauses. */
export async function shopHoursOf(scope: Scope, sellerIds: string[], now = new Date()): Promise<Map<string, ShopHours>> {
  const ids = [...new Set(sellerIds)]
  if (!ids.length) return new Map()
  const service = shopHoursService(scope)
  const since = new Date(now.getTime() - HISTORY_MS)
  const [weekly, exceptions, pauses, zones] = await Promise.all([
    // The model keeps hours and periods as untyped JSON.
    service.listShopWeeklyHours({ seller_id: ids }) as unknown as Promise<WeeklyRow[]>,
    service.listShopHoursExceptions(
      { seller_id: ids, ends_on: { $gte: since.toISOString().slice(0, 10) } },
      { order: { starts_on: "ASC" } }
    ) as unknown as Promise<ExceptionRow[]>,
    service.listShopPauses({ seller_id: ids, $or: [{ ends_at: null }, { ends_at: { $gte: since } }] }, { order: { starts_at: "ASC" } }) as Promise<
      PauseRow[]
    >,
    timeZonesOf(scope, ids),
  ])
  return new Map(
    weekly.map((row) => [
      row.seller_id,
      {
        time_zone: zones.get(row.seller_id) ?? SHIPBUBBLE_TIMEZONE,
        weekly: row.weekly,
        exceptions: exceptions.filter((e) => e.seller_id === row.seller_id).map(toException),
        pauses: pauses
          .filter((p) => p.seller_id === row.seller_id)
          .map((p) => ({ starts_at: iso(p.starts_at), ends_at: p.ends_at ? iso(p.ends_at) : null, note: p.note })),
      },
    ])
  )
}

const toException = ({ starts_on, ends_on, closed, periods, note }: ExceptionRow): HoursException => ({
  starts_on,
  ends_on,
  closed,
  periods,
  note,
})

/** The shops that have set weekly hours: the onboarding gate (ADR 0007). */
export async function sellersWithHours(scope: Scope, sellerIds: string[]): Promise<Set<string>> {
  if (!sellerIds.length) return new Set()
  const rows = (await shopHoursService(scope).listShopWeeklyHours({ seller_id: sellerIds }, { select: ["seller_id"] })) as unknown as WeeklyRow[]
  return new Set(rows.map((r) => r.seller_id))
}

/** A shop's status as buyers see it, with the label the apps show (in the region's timezone). */
export type ShopStatusView = ShopStatus & { label: string; orderable: boolean }

const statusView = (hours: ShopHours, now: Date): ShopStatusView => {
  const status = shopStatus(hours, now)
  return { ...status, label: shopStatusLabel(status, now, hours.time_zone), orderable: isOrderable(status) }
}

/**
 * Each shop's status now. A shop without hours isn't live, so buyers never see one; should it
 * appear, it counts as closed with no opening, and not orderable.
 */
export async function shopStatusesOf(scope: Scope, sellerIds: string[], now = new Date()): Promise<Map<string, ShopStatusView>> {
  const hours = await shopHoursOf(scope, sellerIds, now)
  return new Map(
    sellerIds.map((id) => {
      const shop = hours.get(id)
      return [
        id,
        shop
          ? statusView(shop, now)
          : { state: "closed_until", reason: "exception", until: null, note: null, label: "Closed until further notice", orderable: false },
      ]
    })
  )
}

/**
 * Refuses (400) when any of the shops is in a closed exception or paused: its items can't be
 * added to a cart or paid for until it reopens (ADR 0004). Outside its hours a shop still takes orders.
 */
export async function refuseClosedShops(scope: Scope, sellerIds: string[], now = new Date()) {
  const ids = [...new Set(sellerIds)]
  if (!ids.length) return
  const statuses = await shopStatusesOf(scope, ids, now)
  const closed = ids.find((id) => !statuses.get(id)!.orderable)
  if (!closed) return
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "seller", fields: ["id", "name"], filters: { id: closed } })
  throw closedShopError((data[0] as { name: string } | undefined)?.name ?? "This shop", statuses.get(closed)!)
}

/** Why a shop in a closed exception or paused can't be ordered from, with its note. */
export function closedShopError(shopName: string, status: ShopStatusView) {
  const note = status.state === "closed_until" && status.note ? ` ${status.note}` : ""
  return new MedusaError(MedusaError.Types.NOT_ALLOWED, `${shopName} isn't taking orders. ${status.label}.${note}`)
}

/** What the vendor panel and vendor app show of the shop's hours. */
export type VendorShopHours = {
  time_zone: string
  /** Null until the shop sets them; it isn't live until then. */
  weekly: WeeklyHours | null
  /** Exceptions not yet over, soonest first. */
  exceptions: (HoursException & { id: string })[]
  /** The pause in force, if any. */
  pause: { id: string; starts_at: string; ends_at: string | null; note: string | null } | null
  /** What buyers see now; null until weekly hours are set. */
  status: ShopStatusView | null
  /** How many orders wait to be accepted: pausing doesn't stop their clocks (ADR 0004). */
  new_orders: number
}

/** The shop's hours, exceptions and pause for its members. */
export async function vendorShopHours(scope: Scope, sellerId: string, now = new Date()): Promise<VendorShopHours> {
  const service = shopHoursService(scope)
  const [hours, zones, exceptions, pauses, newOrders] = await Promise.all([
    shopHoursOf(scope, [sellerId], now),
    timeZonesOf(scope, [sellerId]),
    service.listShopHoursExceptions({ seller_id: sellerId }, { order: { starts_on: "ASC" } }) as unknown as Promise<ExceptionRow[]>,
    service.listShopPauses(pauseInForce(sellerId, now)) as Promise<PauseRow[]>,
    newOrderCount(scope, sellerId),
  ])
  const time_zone = zones.get(sellerId) ?? SHIPBUBBLE_TIMEZONE
  const today = todayIn(time_zone, now)
  const shop = hours.get(sellerId)
  const pause = pauses[0]
  return {
    time_zone,
    weekly: shop?.weekly ?? null,
    exceptions: exceptions.filter((e) => e.ends_on >= today).map((e) => ({ id: e.id, ...toException(e) })),
    pause: pause
      ? { id: pause.id, starts_at: iso(pause.starts_at), ends_at: pause.ends_at ? iso(pause.ends_at) : null, note: pause.note }
      : null,
    status: shop ? statusView(shop, now) : null,
    new_orders: newOrders,
  }
}

/** How many of the shop's orders wait to be accepted. */
async function newOrderCount(scope: Scope, sellerId: string): Promise<number> {
  const [, count] = await scope
    .resolve<OrderFulfilmentModuleService>(ORDER_FULFILMENT_MODULE)
    .listAndCountOrderFulfilments({ seller_id: sellerId, state: "new" }, { select: ["id"], take: 1 })
  return count
}

const invalid = (errors: string[]) => {
  if (errors.length) throw new MedusaError(MedusaError.Types.INVALID_DATA, `${errors.join(". ")}.`)
}

/** Sets the shop's weekly hours; refused (400) when a day's periods are wrong or it never opens. */
export async function setWeeklyHours(scope: MedusaContainer, sellerId: string, weekly: WeeklyHours) {
  invalid(weeklyHoursErrors(weekly))
  const sorted = Object.fromEntries(
    Object.entries(weekly).map(([day, periods]) => [day, [...periods].sort((a, b) => a.opens.localeCompare(b.opens))])
  ) as WeeklyHours
  await setShopWeeklyHoursWorkflow(scope).run({ input: { seller_id: sellerId, weekly: sorted } })
}

/** Adds a closed or special-hours date range; refused (400) when it is wrong or already over. */
export async function addHoursException(
  scope: MedusaContainer,
  sellerId: string,
  input: Omit<HoursException, "note"> & { note?: string | null },
  now = new Date()
) {
  invalid(hoursExceptionErrors(input))
  const zone = (await timeZonesOf(scope, [sellerId])).get(sellerId) ?? SHIPBUBBLE_TIMEZONE
  if (input.ends_on < todayIn(zone, now)) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Those days are already over.")
  // One exception a day, so it is clear which one holds (YYYY-MM-DD dates compare as strings).
  const overlapping = await shopHoursService(scope).listShopHoursExceptions({
    seller_id: sellerId,
    starts_on: { $lte: input.ends_on },
    ends_on: { $gte: input.starts_on },
  })
  if (overlapping.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Those days overlap a closure or special hours you already have. Remove that one first."
    )
  }
  await createShopHoursExceptionWorkflow(scope).run({
    input: {
      seller_id: sellerId,
      starts_on: input.starts_on,
      ends_on: input.ends_on,
      closed: input.closed,
      periods: input.closed ? [] : input.periods,
      note: input.note?.trim() || null,
    },
  })
}

/**
 * Removes one of the shop's exceptions; another shop's is not found. One that started before
 * today is ended yesterday instead: the days already past stay as they were, so orders that
 * waited through them keep their accept clocks (ADR 0004).
 */
export async function removeHoursException(scope: MedusaContainer, sellerId: string, exceptionId: string, now = new Date()) {
  const [exception] = (await shopHoursService(scope).listShopHoursExceptions({
    id: exceptionId,
    seller_id: sellerId,
  })) as unknown as ExceptionRow[]
  if (!exception) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Exception ${exceptionId} not found`)
  const zone = (await timeZonesOf(scope, [sellerId])).get(sellerId) ?? SHIPBUBBLE_TIMEZONE
  const today = todayIn(zone, now)
  if (exception.starts_on < today) {
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    await endShopHoursExceptionWorkflow(scope).run({ input: { id: exceptionId, ends_on: yesterday } })
  } else {
    await deleteShopHoursExceptionWorkflow(scope).run({ input: { id: exceptionId } })
  }
}

/** Pauses orders now, until resumed or `until`, which must be to come. */
export async function pauseShop(
  scope: MedusaContainer,
  sellerId: string,
  input: { until?: string | null; note?: string | null },
  now = new Date()
) {
  const until = input.until ? new Date(input.until) : null
  if (until && until <= now) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Choose a time to reopen that is still to come.")
  await pauseShopWorkflow(scope).run({
    input: { seller_id: sellerId, at: now, ends_at: until, note: input.note?.trim() || null },
  })
}

/** Takes orders again now. */
export async function resumeShop(scope: MedusaContainer, sellerId: string, now = new Date()) {
  await resumeShopWorkflow(scope).run({ input: { seller_id: sellerId, at: now } })
}
