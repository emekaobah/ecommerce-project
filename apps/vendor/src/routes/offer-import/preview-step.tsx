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

/** Every row as the import will treat it: offered, proposed, or skipped for its errors. */
export const PreviewStep = ({ sheet, preview, mapping, onBack, onImported }: Props) => {
  const { t } = useTranslation()
  const run = useMutation({
    mutationFn: () => client.vendor.offerImport.mutate({ csv: sheet.csv, mapping }),
    onSuccess: onImported,
  })
  const { offers, proposals, invalid } = preview.summary
  const ready = offers + proposals

  return (
    <div className="flex flex-col gap-y-6">
      <div className="flex flex-wrap gap-2">
        <StatusBadge color="green">{t("offerImport.preview.offers", { count: offers })}</StatusBadge>
        <StatusBadge color="blue">{t("offerImport.preview.proposals", { count: proposals })}</StatusBadge>
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
              <Table.Cell>{row.stock === null ? t("offerImport.untracked") : row.stock}</Table.Cell>
              <Table.Cell>
                {row.action === "offer" && <StatusBadge color="green">{t("offerImport.preview.offer")}</StatusBadge>}
                {row.action === "propose" && <StatusBadge color="blue">{t("offerImport.preview.propose")}</StatusBadge>}
                {row.action === null && <StatusBadge color="red">{t("offerImport.preview.skip")}</StatusBadge>}
              </Table.Cell>
              <Table.Cell className="whitespace-normal">
                <RowNotes errors={row.errors} warnings={row.warnings} />
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
