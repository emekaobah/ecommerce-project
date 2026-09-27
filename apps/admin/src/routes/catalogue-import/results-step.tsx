import { Button, StatusBadge, Table } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { RowIssues } from "./row-issues"
import type { ImportOutcome } from "./types"

const STATUS_COLOR = { created: "green", skipped: "grey", failed: "red" } as const

/** What happened to each row, with links to the draft products created. */
export const ResultsStep = ({ outcome, onRestart }: { outcome: ImportOutcome; onRestart: () => void }) => {
  const { t } = useTranslation()
  const { created, skipped, failed } = outcome.summary

  return (
    <div className="flex flex-col gap-y-6">
      <div className="flex flex-wrap gap-2">
        <StatusBadge color="green">{t("catalogueImport.results.created", { count: created })}</StatusBadge>
        {skipped > 0 && <StatusBadge color="grey">{t("catalogueImport.results.skipped", { count: skipped })}</StatusBadge>}
        {failed > 0 && <StatusBadge color="red">{t("catalogueImport.results.failed", { count: failed })}</StatusBadge>}
      </div>
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
          {outcome.results.map((result) => (
            <Table.Row key={result.row} className="h-auto">
              <Table.Cell>{result.row}</Table.Cell>
              <Table.Cell>
                {result.product_id ? (
                  <Link to={`/products/${result.product_id}`} className="text-ui-fg-interactive hover:underline">
                    {result.title}
                  </Link>
                ) : (
                  (result.title ?? "–")
                )}
              </Table.Cell>
              <Table.Cell>
                <StatusBadge color={STATUS_COLOR[result.status]}>{t(`catalogueImport.results.status.${result.status}`)}</StatusBadge>
              </Table.Cell>
              <Table.Cell className="whitespace-normal">
                <RowIssues errors={result.errors} warnings={result.warnings} missing={result.missing} />
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
      <div>
        <Button variant="secondary" size="small" onClick={onRestart}>
          {t("catalogueImport.results.again")}
        </Button>
      </div>
    </div>
  )
}
