import { Button, StatusBadge, Table, Text } from "@medusajs/ui"
import { useMutation } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { client } from "../../lib/client"
import { RowNotes } from "./row-notes"
import type { ImportOutcome, Mapping, Preview, Sheet } from "./types"

type Props = {
  sheet: Sheet
  preview: Preview
  mapping: Mapping
  onBack: () => void
  onImported: (outcome: ImportOutcome) => void
}

const amount = (value: number | null) => (value === null ? "–" : value.toLocaleString())

const ACTION_COLOR = { offer: "green", propose: "blue", update: "orange", unchanged: "grey", skip: "red" } as const

/** Every row as the import will treat it: offered, proposed, or skipped for its errors. */
export const PreviewStep = ({ sheet, preview, mapping, onBack, onImported }: Props) => {
  const { t } = useTranslation()
  const run = useMutation({
    mutationFn: () => client.vendor.offerImport.mutate({ csv: sheet.csv, mapping }),
    onSuccess: onImported,
  })
  const { offers, proposals, updates, unchanged, invalid } = preview.summary
  const ready = offers + proposals + updates
  // An update or unchanged row shows only what the sheet changes; a blank cell leaves the offer as it is.
  const stockLabel = (row: Preview["rows"][number]) => {
    if (row.stock !== null) return row.stock
    return row.action === "offer" || row.action === "propose" ? t("offerImport.untracked") : "–"
  }

  return (
    <div className="flex flex-col gap-y-6">
      <div className="flex flex-wrap gap-2">
        <StatusBadge color="green">{t("offerImport.preview.offers", { count: offers })}</StatusBadge>
        <StatusBadge color="blue">{t("offerImport.preview.proposals", { count: proposals })}</StatusBadge>
        {updates > 0 && <StatusBadge color="orange">{t("offerImport.preview.updates", { count: updates })}</StatusBadge>}
        {unchanged > 0 && <StatusBadge color="grey">{t("offerImport.preview.unchangedCount", { count: unchanged })}</StatusBadge>}
        {invalid > 0 && <StatusBadge color="red">{t("offerImport.preview.invalid", { count: invalid })}</StatusBadge>}
      </div>
      <Text size="small" className="text-ui-fg-subtle">
        {t("offerImport.preview.explain")}
      </Text>
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>{t("offerImport.row")}</Table.HeaderCell>
            <Table.HeaderCell>{t("offerImport.product")}</Table.HeaderCell>
            <Table.HeaderCell>{t("offerImport.price")}</Table.HeaderCell>
            <Table.HeaderCell>{t("offerImport.cost")}</Table.HeaderCell>
            <Table.HeaderCell>{t("offerImport.stock")}</Table.HeaderCell>
            <Table.HeaderCell>{t("offerImport.status")}</Table.HeaderCell>
            <Table.HeaderCell>{t("offerImport.notes")}</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {preview.rows.map((row) => (
            <Table.Row key={row.row} className="h-auto">
              <Table.Cell>{row.row}</Table.Cell>
              <Table.Cell>{row.title ?? "–"}</Table.Cell>
              <Table.Cell>{amount(row.price)}</Table.Cell>
              <Table.Cell>{amount(row.cost)}</Table.Cell>
              <Table.Cell>{stockLabel(row)}</Table.Cell>
              <Table.Cell>
                <StatusBadge color={ACTION_COLOR[row.action ?? "skip"]}>{t(`offerImport.preview.${row.action ?? "skip"}`)}</StatusBadge>
              </Table.Cell>
              <Table.Cell className="whitespace-normal">
                <RowNotes errors={row.errors} warnings={row.warnings} changes={row.changes} />
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
      {run.isError && (
        <Text size="small" className="text-ui-fg-error">
          {run.error.message}
        </Text>
      )}
      <div className="flex gap-x-2">
        <Button variant="secondary" size="small" onClick={onBack} disabled={run.isPending}>
          {t("offerImport.back")}
        </Button>
        <Button size="small" isLoading={run.isPending} disabled={ready === 0} onClick={() => run.mutate()}>
          {t("offerImport.preview.import", { count: ready })}
        </Button>
      </div>
    </div>
  )
}
