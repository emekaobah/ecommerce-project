import { Button, StatusBadge, Table, Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { RowNotes } from "./row-notes"
import type { ImportOutcome } from "./types"

const STATUS_COLOR = { offered: "green", updated: "green", proposed: "blue", unchanged: "grey", skipped: "grey", failed: "red" } as const

/** What happened to each row, with links to the offers created. */
export const ResultsStep = ({ outcome, onRestart }: { outcome: ImportOutcome; onRestart: () => void }) => {
  const { t } = useTranslation()
  const { offered, updated, unchanged, proposed, skipped, failed } = outcome.summary

  return (
    <div className="flex flex-col gap-y-6">
      <div className="flex flex-wrap gap-2">
        <StatusBadge color="green">{t("offerImport.results.offered", { count: offered })}</StatusBadge>
        <StatusBadge color="blue">{t("offerImport.results.proposed", { count: proposed })}</StatusBadge>
        {updated > 0 && <StatusBadge color="green">{t("offerImport.results.updated", { count: updated })}</StatusBadge>}
        {unchanged > 0 && <StatusBadge color="grey">{t("offerImport.results.unchanged", { count: unchanged })}</StatusBadge>}
        {skipped > 0 && <StatusBadge color="grey">{t("offerImport.results.skipped", { count: skipped })}</StatusBadge>}
        {failed > 0 && <StatusBadge color="red">{t("offerImport.results.failed", { count: failed })}</StatusBadge>}
      </div>
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>{t("offerImport.row")}</Table.HeaderCell>
            <Table.HeaderCell>{t("offerImport.product")}</Table.HeaderCell>
            <Table.HeaderCell>{t("offerImport.status")}</Table.HeaderCell>
            <Table.HeaderCell>{t("offerImport.notes")}</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {outcome.results.map((result) => (
            <Table.Row key={result.row} className="h-auto">
              <Table.Cell>{result.row}</Table.Cell>
              <Table.Cell>
                {result.offer_id ? (
                  <Link to={`/offers/${result.offer_id}`} className="text-ui-fg-interactive hover:underline">
                    {result.title}
                  </Link>
                ) : (
                  (result.title ?? "–")
                )}
              </Table.Cell>
              <Table.Cell>
                <StatusBadge color={STATUS_COLOR[result.status]}>{t(`offerImport.results.status.${result.status}`)}</StatusBadge>
              </Table.Cell>
              <Table.Cell className="whitespace-normal">
                <RowNotes errors={result.errors} warnings={result.warnings} changes={result.changes} />
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
      {proposed > 0 && (
        <Text size="small" className="text-ui-fg-subtle">
          {t("offerImport.results.review")}
        </Text>
      )}
      <div>
        <Button variant="secondary" size="small" onClick={onRestart}>
          {t("offerImport.results.again")}
        </Button>
      </div>
    </div>
  )
}
