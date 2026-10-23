// Every day and date the apps show reads the same way: "Fri 23 Oct", "23 Oct", "28 Dec 2025".
// The names come from these tables, not the runtime's ICU data, whose abbreviations differ
// between builds ("Sep" or "Sept"), so a device, CI and the server all read alike.

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const

/** Which parts a date label reads: the weekday, the day and month, and the year (with the date). */
export type DateLabelParts = { weekday?: boolean; date?: boolean; year?: boolean }

/** The calendar year, month (1 to 12) and day of an instant in a time zone. */
function calendarDay(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(instant)
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  return { year: part("year"), month: part("month"), day: part("day") }
}

/**
 * "Fri 23 Oct" for an instant (Date, ms or ISO 8601) in `timeZone`; `{ date: false }` reads
 * "Fri", `{ weekday: false }` "23 Oct", and `year: true` adds the year: "28 Dec 2025".
 */
export function dateLabel(at: Date | number | string, timeZone: string, { weekday = true, date = true, year = false }: DateLabelParts = {}): string {
  const instant = typeof at === "string" ? Date.parse(at) : typeof at === "number" ? at : at.getTime()
  const day = calendarDay(instant, timeZone)
  const words: (string | number)[] = []
  if (weekday) words.push(WEEKDAY_SHORT[new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay()]!)
  if (date) words.push(day.day, MONTH_SHORT[day.month - 1]!)
  if (date && year) words.push(day.year)
  return words.join(" ")
}
