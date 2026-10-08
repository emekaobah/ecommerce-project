import { WEEKDAY_NAMES, WEEKDAYS, weeklyHoursErrors, type OpenPeriod, type Weekday, type WeeklyHours } from "@oja/domain"
import { Button, Container, Heading, Input, Text } from "@medusajs/ui"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { client } from "../../lib/client"
import type { ShopHours } from "./types"

const EMPTY: WeeklyHours = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }
const NEW_PERIOD: OpenPeriod = { opens: "08:00", closes: "18:00" }

/** One time field; "24:00" (open until midnight) shows as midnight in the browser's picker. */
const TimeInput = ({ value, label, onChange }: { value: string; label: string; onChange: (value: string) => void }) => (
  <Input
    type="time"
    size="small"
    aria-label={label}
    value={value === "24:00" ? "00:00" : value}
    onChange={(event) => onChange(event.target.value)}
    className="w-28"
  />
)

/**
 * The shop's weekly opening hours: per day, the periods it is open, or closed. Checked as
 * `@oja/domain` checks them on the server, so the reasons match. A closing time of 00:00
 * means open until midnight.
 */
export const WeeklyHoursForm = ({ hours, onSaved }: { hours: ShopHours; onSaved: (hours: ShopHours) => void }) => {
  const { t } = useTranslation()
  const [weekly, setWeekly] = useState<WeeklyHours>(hours.weekly ?? EMPTY)
  const errors = weeklyHoursErrors(weekly)
  const save = useMutation({
    mutationFn: async () => (await client.vendor.shopHours.weekly.mutate({ weekly })).shop_hours,
    onSuccess: onSaved,
  })

  const setDay = (day: Weekday, periods: OpenPeriod[]) => setWeekly((current) => ({ ...current, [day]: periods }))
  const setTime = (day: Weekday, index: number, key: keyof OpenPeriod, value: string) =>
    setDay(
      day,
      weekly[day].map((period, i) => (i === index ? { ...period, [key]: key === "closes" && value === "00:00" ? "24:00" : value } : period))
    )

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-1 px-6 py-4">
        <Heading level="h2">{t("shopHours.weekly.title")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t("shopHours.weekly.description", { timeZone: hours.time_zone })}
        </Text>
      </div>
      <form
        className="flex flex-col gap-y-3 px-6 py-4"
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
      >
        {WEEKDAYS.map((day) => (
          <div key={day} className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Text size="small" weight="plus" className="w-24">
              {WEEKDAY_NAMES[day]}
            </Text>
            {!weekly[day].length && (
              <Text size="small" className="text-ui-fg-muted">
                {t("shopHours.weekly.closed")}
              </Text>
            )}
            {weekly[day].map((period, index) => (
              <div key={index} className="flex items-center gap-x-1">
                <TimeInput value={period.opens} label={t("shopHours.opens")} onChange={(v) => setTime(day, index, "opens", v)} />
                <Text size="small">–</Text>
                <TimeInput value={period.closes} label={t("shopHours.closes")} onChange={(v) => setTime(day, index, "closes", v)} />
                <Button
                  type="button"
                  size="small"
                  variant="transparent"
                  onClick={() => setDay(day, weekly[day].filter((_, i) => i !== index))}
                >
                  {t("shopHours.remove")}
                </Button>
              </div>
            ))}
            <Button type="button" size="small" variant="secondary" onClick={() => setDay(day, [...weekly[day], NEW_PERIOD])}>
              {t(weekly[day].length ? "shopHours.weekly.addPeriod" : "shopHours.weekly.open")}
            </Button>
          </div>
        ))}
        {(errors.length > 0 || save.isError) && (
          <Text size="small" className="text-ui-fg-error">
            {save.error?.message ?? errors.join(". ")}
          </Text>
        )}
        <div>
          <Button type="submit" size="small" isLoading={save.isPending} disabled={errors.length > 0}>
            {t("shopHours.weekly.save")}
          </Button>
        </div>
      </form>
    </Container>
  )
}
