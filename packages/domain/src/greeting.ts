// Home's band greets the buyer: "Good morning, Tolu." A guest, or a buyer whose account has no
// first name, is greeted without one.

/** The hour (0 to 23) of an instant in a time zone. */
function hourIn(now: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(now)
  return Number(hour)
}

/** "Good morning" from 5am, "Good afternoon" from noon, "Good evening" from 5pm through the night. */
function partOfDay(hour: number): "morning" | "afternoon" | "evening" {
  if (hour >= 5 && hour < 12) return "morning"
  if (hour >= 12 && hour < 17) return "afternoon"
  return "evening"
}

/** "Good morning, Tolu." for the time of day in `timeZone`; "Good morning." without a first name. */
export function greeting(now: Date, firstName: string | null, timeZone: string): string {
  const name = firstName?.trim()
  const hello = `Good ${partOfDay(hourIn(now, timeZone))}`
  return name ? `${hello}, ${name}.` : `${hello}.`
}
