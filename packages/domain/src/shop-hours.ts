/**
 * Shop hours and closures (ADR 0004, docs/design.md → Shop hours and closures): when a shop is
 * open, when it next opens, and how much open time passes between two instants. Every time is
 * in the shop's region's timezone.
 */

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const
export type Weekday = (typeof WEEKDAYS)[number]

/** One stretch of a day the shop is open, as local "HH:MM" times; `closes` may be "24:00". */
export type OpenPeriod = { opens: string; closes: string }

/** Per weekday, the periods the shop is open: none means closed all day. */
export type WeeklyHours = Record<Weekday, OpenPeriod[]>

export type ShopHours = {
  /** The region's IANA timezone, e.g. "Africa/Lagos". */
  time_zone: string
  weekly: WeeklyHours
  exceptions: HoursException[]
  pauses: ShopPause[]
}

/** A date or date range (local "YYYY-MM-DD", both ends included) closed, or open with special hours. */
export type HoursException = {
  starts_on: string
  ends_on: string
  closed: boolean
  /** The day's hours when not closed. */
  periods: OpenPeriod[]
  note: string | null
}

/** Closed from `starts_at` until resumed or `ends_at` (ISO 8601); null `ends_at` means not resumed yet. */
export type ShopPause = { starts_at: string; ends_at: string | null; note?: string | null }

type Interval = { start: number; end: number }

const DAY_MS = 24 * 60 * 60 * 1000

/** The local calendar date of an instant, as YYYY-MM-DD. */
export const dateIn = (instant: number, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(instant)

/** The date `days` after a YYYY-MM-DD date. */
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)

const weekdayOf = (date: string): Weekday => WEEKDAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]!

/** How far ahead of UTC the timezone is at an instant, in ms. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(instant)
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  const asUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"))
  return asUtc - Math.floor(instant / 1000) * 1000
}

/** The instant a local date and "HH:MM" time (up to "24:00") falls on in the timezone. */
function instantOf(date: string, time: string, timeZone: string): number {
  const [hours, minutes] = time.split(":").map(Number) as [number, number]
  const local = Date.parse(`${date}T00:00:00Z`) + (hours * 60 + minutes) * 60 * 1000
  // The offset at the local time read as UTC is close; checking it at the result settles DST.
  const first = local - offsetAt(local, timeZone)
  return local - offsetAt(first, timeZone)
}

/** The periods the shop keeps on a local date: an exception's when one covers it, else its weekday's. */
function periodsOn(hours: ShopHours, date: string): OpenPeriod[] {
  const exception = exceptionOn(hours, date)
  if (exception) return exception.closed ? [] : exception.periods
  return hours.weekly[weekdayOf(date)] ?? []
}

/** The exception covering a local date; YYYY-MM-DD dates compare as strings. */
const exceptionOn = (hours: ShopHours, date: string) =>
  hours.exceptions.find((e) => e.starts_on <= date && date <= e.ends_on)

const pauseIntervals = (hours: ShopHours): Interval[] =>
  hours.pauses.map((p) => ({ start: Date.parse(p.starts_at), end: p.ends_at ? Date.parse(p.ends_at) : Infinity }))

/** What is left of sorted, separate intervals once the closures are taken out. */
function without(intervals: Interval[], closures: Interval[]): Interval[] {
  return closures.reduce(
    (open, closed) =>
      open.flatMap((i) =>
        closed.end <= i.start || closed.start >= i.end
          ? [i]
          : [
              { start: i.start, end: closed.start },
              { start: closed.end, end: i.end },
            ].filter((part) => part.start < part.end)
      ),
    intervals
  )
}

/** Joins touching or overlapping intervals; the input is sorted by start. */
function merge(intervals: Interval[]): Interval[] {
  const merged: Interval[] = []
  for (const interval of intervals) {
    const last = merged.at(-1)
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end)
    else merged.push({ ...interval })
  }
  return merged
}

/** When the shop's hours (weekly, or an exception's) keep it open between two instants, pauses aside: sorted, separate, clipped. */
function scheduledIntervals(hours: ShopHours, from: number, to: number): Interval[] {
  const intervals: Interval[] = []
  // A day either side covers periods that start before `from` or timezones far from UTC.
  const last = addDays(dateIn(to, hours.time_zone), 1)
  for (let date = addDays(dateIn(from, hours.time_zone), -1); date <= last; date = addDays(date, 1)) {
    for (const period of periodsOn(hours, date)) {
      intervals.push({ start: instantOf(date, period.opens, hours.time_zone), end: instantOf(date, period.closes, hours.time_zone) })
    }
  }
  intervals.sort((a, b) => a.start - b.start)
  return merge(intervals)
    .map((i) => ({ start: Math.max(i.start, from), end: Math.min(i.end, to) }))
    .filter((i) => i.start < i.end)
}

/** When the shop is open between two instants, as sorted, separate intervals clipped to them. */
const openIntervals = (hours: ShopHours, from: number, to: number): Interval[] =>
  without(scheduledIntervals(hours, from, to), pauseIntervals(hours))

/** How far ahead the clocks look for the shop to open: a shop closed longer counts as not reopening. */
const HORIZON_MS = 400 * DAY_MS
const WINDOW_MS = 7 * DAY_MS

/** The shop's open intervals from an instant on, a week at a time, up to the horizon. */
function* openIntervalsFrom(hours: ShopHours, from: number): Generator<Interval> {
  for (let start = from; start < from + HORIZON_MS; start += WINDOW_MS) {
    // A pause that hasn't been resumed closes the shop for good from its start.
    if (hours.pauses.some((p) => !p.ends_at && Date.parse(p.starts_at) <= start)) return
    yield* openIntervals(hours, start, start + WINDOW_MS)
  }
}

/** When the shop next opens: the instant itself while open; null when it doesn't reopen (an unresumed pause, no hours). */
export function nextOpening(hours: ShopHours, at: Date): Date | null {
  const first = openIntervalsFrom(hours, at.getTime()).next()
  return first.done ? null : new Date(first.value.start)
}

/**
 * When the shop, open at an instant, next closes: the end of the stretch of open time it is in,
 * which runs on past midnight when the hours do. Null when it isn't open, or doesn't close
 * before the horizon (open round the clock).
 */
export function closingTime(hours: ShopHours, at: Date): Date | null {
  let end: number | null = null
  for (const interval of openIntervalsFrom(hours, at.getTime())) {
    if (end === null ? interval.start !== at.getTime() : interval.start > end) break
    end = interval.end
  }
  // Still open at the horizon: or not open at all.
  if (end === null || end >= at.getTime() + HORIZON_MS) return null
  return new Date(end)
}

/** How much open time (ms) passes between two instants: closed hours, closed exceptions and pauses don't count. */
export function openTimeBetween(hours: ShopHours, from: Date, to: Date): number {
  if (to <= from) return 0
  return openIntervals(hours, from.getTime(), to.getTime()).reduce((total, i) => total + (i.end - i.start), 0)
}

/**
 * The instant by which `openTime` (ms) of open time has passed since `from`: the clock of
 * deadlines that count only time the shop is open (ADR 0004). Null when the shop doesn't
 * reopen to finish it (an unresumed pause).
 */
export function afterOpenTime(hours: ShopHours, from: Date, openTime: number): Date | null {
  let left = openTime
  for (const interval of openIntervalsFrom(hours, from.getTime())) {
    const length = interval.end - interval.start
    if (left <= length) return new Date(interval.start + left)
    left -= length
  }
  return null
}

/**
 * When the shop closes on the `days`th open day after the day of `from`: the clock of deadlines
 * counted in open days (ADR 0004). An open day is a calendar day the shop opens on; the day of
 * `from` doesn't count, nor do days closed by an exception or a pause. Null while the shop is
 * paused, with no resume date, before that day's closing.
 */
export function afterOpenDays(hours: ShopHours, from: Date, days: number): Date | null {
  const unresumed = Math.min(...hours.pauses.filter((p) => !p.ends_at).map((p) => Date.parse(p.starts_at)))
  let date = dateIn(from.getTime(), hours.time_zone)
  let left = days
  for (let checked = 0; checked < HORIZON_MS / DAY_MS; checked++) {
    date = addDays(date, 1)
    const start = instantOf(date, "00:00", hours.time_zone)
    if (start >= unresumed) return null
    const end = instantOf(date, "24:00", hours.time_zone)
    if (!openIntervals(hours, start, end).length) continue
    left -= 1
    if (left > 0) continue
    // Closing time is the day's hours', even when a pause covers the end of the day.
    const closes = scheduledIntervals(hours, start, end).at(-1)!.end
    return closes < unresumed ? new Date(closes) : null
  }
  return null
}

/** Whether the shop is open at an instant. */
export function isOpenAt(hours: ShopHours, at: Date): boolean {
  const t = at.getTime()
  return openIntervals(hours, t, t + 1).length > 0
}

/**
 * Whether buyers can order from the shop, and what they see (ADR 0004):
 * - `open`: until `closes_at` (null: open round the clock);
 * - `closed`: outside its hours (regular or a day's special hours). Still orderable: the order
 *   is prepared when it opens at `opens_at`;
 * - `closed_until`: in a closed exception or paused. Not orderable until `until` (null: not
 *   set to reopen), with the shop's note.
 */
export type ShopStatus =
  | { state: "open"; closes_at: string | null }
  | { state: "closed"; opens_at: string | null }
  | { state: "closed_until"; reason: "exception" | "pause"; until: string | null; note: string | null }

/** The shop's status at an instant. */
export function shopStatus(hours: ShopHours, at: Date): ShopStatus {
  const t = at.getTime()
  const pause = hours.pauses.find((p) => Date.parse(p.starts_at) <= t && (!p.ends_at || t < Date.parse(p.ends_at)))
  const exception = exceptionOn(hours, dateIn(t, hours.time_zone))
  let closure: { reason: "pause" | "exception"; note: string | null } | null = null
  if (pause) closure = { reason: "pause", note: pause.note ?? null }
  else if (exception?.closed) closure = { reason: "exception", note: exception.note }
  const opens = nextOpening(hours, at)?.toISOString() ?? null
  if (closure) return { state: "closed_until", ...closure, until: opens }
  if (opens !== at.toISOString()) return { state: "closed", opens_at: opens }
  return { state: "open", closes_at: closingTime(hours, at)?.toISOString() ?? null }
}

/**
 * The shop's hours on the local day of an instant, with the day's closures applied: none on a
 * day closed by an exception, and what a pause leaves of them. `closure` says why hours are
 * missing or cut, with the shop's note.
 */
export type DayHours = {
  /** Local YYYY-MM-DD. */
  date: string
  periods: OpenPeriod[]
  closure: { reason: "exception" | "pause"; note: string | null } | null
}

/** The local "HH:MM" of an instant. */
const localTime = (instant: number, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).format(instant)

/** The shop's hours today, as of an instant, with today's closure or pause applied. */
export function todaysHours(hours: ShopHours, at: Date): DayHours {
  const date = dateIn(at.getTime(), hours.time_zone)
  const start = instantOf(date, "00:00", hours.time_zone)
  const end = instantOf(date, "24:00", hours.time_zone)
  const pause = hours.pauses.find((p) => Date.parse(p.starts_at) < end && (!p.ends_at || Date.parse(p.ends_at) > start))
  const exception = exceptionOn(hours, date)
  let closure: DayHours["closure"] = null
  if (pause) closure = { reason: "pause", note: pause.note ?? null }
  else if (exception?.closed) closure = { reason: "exception", note: exception.note }
  const periods = openIntervals(hours, start, end).map((i) => ({
    opens: localTime(i.start, hours.time_zone),
    closes: i.end === end ? "24:00" : localTime(i.end, hours.time_zone),
  }))
  return { date, periods, closure }
}

/** Buyers can add the shop's items to a cart and pay for them: not in an exception or pause. */
export const isOrderable = (status: ShopStatus) => status.state !== "closed_until"

export const WEEKDAY_NAMES: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
}

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/

/** What is wrong with one day's periods: a time not HH:MM, closing not after opening, or overlapping periods. */
function periodsError(periods: OpenPeriod[]): string | null {
  if (periods.some((p) => !TIME.test(p.opens) || !TIME.test(p.closes))) return "enter times as HH:MM, e.g. 08:00"
  // HH:MM times compare as strings.
  if (periods.some((p) => p.closes <= p.opens)) return "closing time must be after opening time"
  const sorted = [...periods].sort((a, b) => a.opens.localeCompare(b.opens))
  if (sorted.some((p, i) => i > 0 && p.opens < sorted[i - 1]!.closes)) return "opening times overlap"
  return null
}

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** Why the shop's weekly hours can't be saved; empty when they can. A shop must open on at least one day. */
export function weeklyHoursErrors(weekly: WeeklyHours): string[] {
  const errors = WEEKDAYS.flatMap((day) => {
    const error = periodsError(weekly[day] ?? [])
    return error ? [`${WEEKDAY_NAMES[day]}: ${error}`] : []
  })
  if (!errors.length && WEEKDAYS.every((day) => !weekly[day]?.length)) return ["Add the hours you're open on at least one day"]
  return errors
}

const isDate = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().startsWith(date)

/** Why an exception can't be saved; empty when it can. */
export function hoursExceptionErrors(exception: Omit<HoursException, "note"> & { note?: string | null }): string[] {
  if (!isDate(exception.starts_on) || !isDate(exception.ends_on)) return ["Enter dates as YYYY-MM-DD"]
  if (exception.ends_on < exception.starts_on) return ["The last day can't be before the first"]
  if (exception.closed) return []
  if (!exception.periods.length) return ["Add the special hours, or mark the days closed"]
  const error = periodsError(exception.periods)
  return error ? [capitalised(error)] : []
}

/** "9:30pm", "8am", "12pm": a local time as buyers read it. */
export function timeLabel(instant: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", hour: "numeric", minute: "numeric" }).formatToParts(
    instant
  )
  const hour = Number(parts.find((p) => p.type === "hour")!.value)
  const minute = parts.find((p) => p.type === "minute")!.value
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  const minutes = minute === "00" ? "" : `:${minute}`
  return `${twelve}${minutes}${hour < 12 ? "am" : "pm"}`
}

export const dayLabel = (instant: number, timeZone: string, options: Intl.DateTimeFormatOptions) => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, ...options }).formatToParts(instant)
  const part = (type: string) => parts.find((p) => p.type === type)?.value
  return [part("weekday"), part("day"), part("month")].filter(Boolean).join(" ")
}

/**
 * What the buyer app shows for the shop's status (docs/design.md): "Open · closes 7pm",
 * "Closed · opens 8am Mon", "Closed until Tue 14 Oct", in the region's timezone.
 */
export function shopStatusLabel(status: ShopStatus, now: Date, timeZone: string): string {
  if (status.state === "open") return status.closes_at ? `Open · closes ${closingLabel(status.closes_at, now, timeZone)}` : "Open"
  const at = status.state === "closed" ? status.opens_at : status.until
  if (!at) return status.state === "closed" ? "Closed" : "Closed until further notice"
  const instant = Date.parse(at)
  const sameDay = dateIn(instant, timeZone) === dateIn(now.getTime(), timeZone)
  if (status.state === "closed_until") {
    return `Closed until ${sameDay ? timeLabel(instant, timeZone) : dayLabel(instant, timeZone, { weekday: "short", day: "numeric", month: "short" })}`
  }
  return `Closed · opens ${openingLabel(at, now, timeZone)}`
}

/** "7pm" (today), "midnight" (tonight's), "2am Tue": when an open shop closes (ISO 8601 `closesAt`), in the region's timezone. */
function closingLabel(closesAt: string, now: Date, timeZone: string): string {
  const instant = Date.parse(closesAt)
  const tonight = instantOf(addDays(dateIn(now.getTime(), timeZone), 1), "00:00", timeZone)
  return instant === tonight ? "midnight" : openingLabel(closesAt, now, timeZone)
}

/** "9:30pm" (today), "8am Tue", "8am Tue 13 Oct": when a closed shop opens (ISO 8601 `opensAt`), in the region's timezone. */
export function openingLabel(opensAt: string, now: Date, timeZone: string): string {
  const instant = Date.parse(opensAt)
  const time = timeLabel(instant, timeZone)
  if (dateIn(instant, timeZone) === dateIn(now.getTime(), timeZone)) return time
  const withinWeek = instant - now.getTime() < 6 * DAY_MS
  const day = dayLabel(instant, timeZone, withinWeek ? { weekday: "short" } : { weekday: "short", day: "numeric", month: "short" })
  return `${time} ${day}`
}
