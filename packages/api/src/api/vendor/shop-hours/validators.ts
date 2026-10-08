import { z } from "zod"

// Shapes only; whether the hours make sense (times, overlaps, at least one open day) is
// `@oja/domain`'s to say, so the vendor panel shows the same reasons.

const period = z.object({ opens: z.string(), closes: z.string() })
const periods = z.array(period).max(6)

export const VendorSetWeeklyHours = z.object({
  weekly: z.object({ mon: periods, tue: periods, wed: periods, thu: periods, fri: periods, sat: periods, sun: periods }),
})
export type VendorSetWeeklyHoursType = z.infer<typeof VendorSetWeeklyHours>

export const VendorCreateHoursException = z.object({
  starts_on: z.string(),
  ends_on: z.string(),
  closed: z.boolean(),
  periods: periods.default([]),
  note: z.string().max(200).nullable().optional(),
})
export type VendorCreateHoursExceptionType = z.infer<typeof VendorCreateHoursException>

export const VendorPauseShop = z.object({
  /** When to take orders again (ISO 8601); none: until resumed. */
  until: z.string().datetime({ offset: true }).nullable().optional(),
  note: z.string().max(200).nullable().optional(),
})
export type VendorPauseShopType = z.infer<typeof VendorPauseShop>
