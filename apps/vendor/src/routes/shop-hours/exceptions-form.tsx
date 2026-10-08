import { hoursExceptionErrors } from "@oja/domain"
import { Button, Container, Heading, Input, Label, Switch, Text } from "@medusajs/ui"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { client } from "../../lib/client"
import type { ShopHours } from "./types"

type Draft = { starts_on: string; ends_on: string; closed: boolean; opens: string; closes: string; note: string }
const BLANK: Draft = { starts_on: "", ends_on: "", closed: true, opens: "10:00", closes: "16:00", note: "" }

const toException = (draft: Draft) => ({
  starts_on: draft.starts_on,
  ends_on: draft.ends_on || draft.starts_on,
  closed: draft.closed,
  periods: draft.closed ? [] : [{ opens: draft.opens, closes: draft.closes }],
  note: draft.note.trim() || null,
})

/**
 * Days the shop is closed (holidays, stocktakes) or open with special hours instead of its
 * weekly ones, which is also how it opens on a day it is normally closed. Buyers see a closed
 * day as "Closed until …" with the note, and can't order until it reopens.
 */
export const ExceptionsForm = ({ hours, onSaved }: { hours: ShopHours; onSaved: (hours: ShopHours) => void }) => {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<Draft>(BLANK)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const errors = draft.starts_on ? hoursExceptionErrors(toException(draft)) : []

  const add = useMutation({
    mutationFn: async () => (await client.vendor.shopHours.exceptions.mutate(toException(draft))).shop_hours,
    onSuccess: (saved) => {
      setDraft(BLANK)
      onSaved(saved)
    },
  })
  const remove = useMutation({
    mutationFn: async (id: string) => (await client.vendor.shopHours.exceptions.$id.delete({ $id: id })).shop_hours,
    onSuccess: onSaved,
  })

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-1 px-6 py-4">
        <Heading level="h2">{t("shopHours.exceptions.title")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t("shopHours.exceptions.description")}
        </Text>
      </div>
      <div className="flex flex-col gap-y-2 px-6 py-4">
        {!hours.exceptions.length && (
          <Text size="small" className="text-ui-fg-muted">
            {t("shopHours.exceptions.none")}
          </Text>
        )}
        {hours.exceptions.map((exception) => (
          <div key={exception.id} className="flex flex-wrap items-center gap-x-3">
            <Text size="small" weight="plus">
              {exception.starts_on === exception.ends_on ? exception.starts_on : `${exception.starts_on} – ${exception.ends_on}`}
            </Text>
            <Text size="small">
              {exception.closed
                ? t("shopHours.exceptions.closed")
                : exception.periods.map((p) => `${p.opens}–${p.closes}`).join(", ")}
            </Text>
            {exception.note && (
              <Text size="small" className="text-ui-fg-subtle">
                {exception.note}
              </Text>
            )}
            <Button
              size="small"
              variant="transparent"
              isLoading={remove.isPending && remove.variables === exception.id}
              onClick={() => remove.mutate(exception.id)}
            >
              {t("shopHours.remove")}
            </Button>
          </div>
        ))}
      </div>
      <form
        className="grid max-w-2xl grid-cols-1 gap-4 px-6 py-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault()
          add.mutate()
        }}
      >
        <div className="flex flex-col gap-y-2">
          <Label htmlFor="exception-from" weight="plus">
            {t("shopHours.exceptions.from")}
          </Label>
          <Input id="exception-from" type="date" value={draft.starts_on} onChange={(e) => set("starts_on", e.target.value)} />
        </div>
        <div className="flex flex-col gap-y-2">
          <Label htmlFor="exception-to" weight="plus">
            {t("shopHours.exceptions.to")}
          </Label>
          <Input id="exception-to" type="date" value={draft.ends_on} onChange={(e) => set("ends_on", e.target.value)} />
        </div>
        <div className="flex items-center gap-x-2 md:col-span-2">
          <Switch id="exception-closed" checked={draft.closed} onCheckedChange={(closed) => set("closed", closed)} />
          <Label htmlFor="exception-closed">{t("shopHours.exceptions.closedAllDay")}</Label>
        </div>
        {!draft.closed && (
          <div className="flex items-center gap-x-2 md:col-span-2">
            <Input type="time" size="small" aria-label={t("shopHours.opens")} value={draft.opens} onChange={(e) => set("opens", e.target.value)} />
            <Text size="small">–</Text>
            <Input type="time" size="small" aria-label={t("shopHours.closes")} value={draft.closes} onChange={(e) => set("closes", e.target.value)} />
          </div>
        )}
        <div className="flex flex-col gap-y-2 md:col-span-2">
          <Label htmlFor="exception-note" weight="plus">
            {t("shopHours.exceptions.note")}
          </Label>
          <Input
            id="exception-note"
            value={draft.note}
            maxLength={200}
            placeholder={t("shopHours.exceptions.notePlaceholder")}
            onChange={(e) => set("note", e.target.value)}
          />
        </div>
        {(errors.length > 0 || add.isError) && (
          <Text size="small" className="text-ui-fg-error md:col-span-2">
            {add.error?.message ?? errors.join(". ")}
          </Text>
        )}
        <div className="md:col-span-2">
          <Button type="submit" size="small" isLoading={add.isPending} disabled={!draft.starts_on || errors.length > 0}>
            {t("shopHours.exceptions.add")}
          </Button>
        </div>
      </form>
    </Container>
  )
}
