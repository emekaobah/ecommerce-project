import { Button, StatusBadge, Table, Text } from "@medusajs/ui"
import { useMutation } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { client } from "../../lib/client"
import { RowIssues } from "./row-issues"
import type { ImportOutcome, Mapping, Preview, Sheet } from "./types"

type Props = {
  sheet: Sheet
  preview: Preview
  mapping: Mapping
  onBack: () => void
  onImported: (outcome: ImportOutcome) => void
}

/** Every row as the import will treat it; rows with errors are left out of the import. */
export const PreviewStep = ({ sheet, preview, mapping, onBack, onImported }: Props) => {
  const { t } = useTranslation()
  const run = useMutation({
    mutationFn: () => client.admin.catalogueImport.mutate({ csv: sheet.csv, source: sheet.source, mapping }),
    onSuccess: onImported,
  })
  const { valid, invalid } = preview.summary

  return (
    <div className="flex flex-col gap-y-6">
      <div className="flex flex-wrap gap-2">
        <StatusBadge color="green">{t("catalogueImport.preview.valid", { count: valid })}</StatusBadge>
        {invalid > 0 && <StatusBadge color="red">{t("catalogueImport.preview.invalid", { count: invalid })}</StatusBadge>}
      </div>
      <Text size="small" className="text-ui-fg-subtle">
        {t("catalogueImport.preview.drafts")}
      </Text>
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>{t("catalogueImport.row")}</Table.HeaderCell>
            <Table.HeaderCell>{t("catalogueImport.product")}</Table.HeaderCell>
            <Table.HeaderCell>{t("catalogueImport.status")}</Table.HeaderCell>
            <Table.HeaderCell>{t("catalogueImport.notes")}</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {preview.rows.map((row) => (
            <Table.Row key={row.row} className="h-auto">
              <Table.Cell>{row.row}</Table.Cell>
              <Table.Cell>{row.title ?? "–"}</Table.Cell>
              <Table.Cell>
                {row.errors.length ? (
                  <StatusBadge color="red">{t("catalogueImport.preview.skip")}</StatusBadge>
                ) : (
                  <StatusBadge color="green">{t("catalogueImport.preview.ready")}</StatusBadge>
                )}
              </Table.Cell>
              <Table.Cell className="whitespace-normal">
                <RowIssues errors={row.errors} warnings={row.warnings} missing={row.missing} />
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
          {t("catalogueImport.back")}
        </Button>
        <Button size="small" isLoading={run.isPending} disabled={valid === 0} onClick={() => run.mutate()}>
          {t("catalogueImport.preview.import", { count: valid })}
        </Button>
      </div>
    </div>
  )
}
