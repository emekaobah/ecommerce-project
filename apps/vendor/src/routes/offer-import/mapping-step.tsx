import { Badge, Button, Select, Table, Text } from "@medusajs/ui"
import { useMutation } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { client } from "../../lib/client"
import type { ImportField, Mapping, Preview, Sheet } from "./types"

type Props = {
  fields: ImportField[]
  sheet: Sheet
  preview: Preview
  mapping: Mapping
  onChange: (mapping: Mapping) => void
  onBack: () => void
  onPreviewed: (preview: Preview) => void
}

const UNMAPPED = "__unmapped"
const GROUPS: ImportField["group"][] = ["product", "variant", "offer"]

/** One row per column of the sheet: what it holds, and the field it fills. */
export const MappingStep = ({ fields, sheet, preview, mapping, onChange, onBack, onPreviewed }: Props) => {
  const { t } = useTranslation()
  const labelOf = new Map(fields.map((f) => [f.key, f.label]))
  // A field mapped from two columns is refused; show which ones clash.
  const clashing = new Set(Object.values(mapping).filter((key, i, all) => all.indexOf(key) !== i))

  const refresh = useMutation({
    mutationFn: () => client.vendor.offerImport.preview.mutate({ csv: sheet.csv, mapping }),
    onSuccess: (next) => {
      if (!next.mapping_errors.length) onPreviewed(next)
    },
  })
  const problems = refresh.data?.mapping_errors ?? []

  const setField = (column: string, key: string) => {
    const next = { ...mapping }
    if (key === UNMAPPED) delete next[column]
    else next[column] = key
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Text size="small" weight="plus">
          {sheet.fileName}
        </Text>
        <Text size="small" className="text-ui-fg-subtle">
          {t("offerImport.mapping.rows", { count: preview.summary.total })}
        </Text>
        <Badge size="2xsmall" color={preview.mapping_origin === "saved" ? "green" : "grey"}>
          {t(`offerImport.mapping.origin.${preview.mapping_origin}`)}
        </Badge>
      </div>
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>{t("offerImport.mapping.column")}</Table.HeaderCell>
            <Table.HeaderCell>{t("offerImport.mapping.sample")}</Table.HeaderCell>
            <Table.HeaderCell>{t("offerImport.mapping.field")}</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {preview.headers.map((column) => (
            <Table.Row key={column}>
              <Table.Cell className="font-medium">{column}</Table.Cell>
              <Table.Cell className="text-ui-fg-subtle max-w-[240px] truncate">{preview.samples[column]}</Table.Cell>
              <Table.Cell className="w-[280px] py-2">
                <Select value={mapping[column] ?? UNMAPPED} onValueChange={(key) => setField(column, key)} size="small">
                  <Select.Trigger aria-invalid={clashing.has(mapping[column])}>
                    <Select.Value>{mapping[column] ? labelOf.get(mapping[column]) : t("offerImport.mapping.unmapped")}</Select.Value>
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value={UNMAPPED}>{t("offerImport.mapping.unmapped")}</Select.Item>
                    {GROUPS.map((group) => (
                      <Select.Group key={group}>
                        <Select.Label>{t(`offerImport.mapping.groups.${group}`)}</Select.Label>
                        {fields
                          .filter((f) => f.group === group)
                          .map((f) => (
                            <Select.Item key={f.key} value={f.key}>
                              {f.label}
                            </Select.Item>
                          ))}
                      </Select.Group>
                    ))}
                  </Select.Content>
                </Select>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
      <Text size="small" className="text-ui-fg-subtle">
        {t("offerImport.mapping.minimum")}
      </Text>
      {[...problems, ...(refresh.isError ? [refresh.error.message] : [])].map((problem) => (
        <Text key={problem} size="small" className="text-ui-fg-error">
          {problem}
        </Text>
      ))}
      <div className="flex gap-x-2">
        <Button variant="secondary" size="small" onClick={onBack}>
          {t("offerImport.back")}
        </Button>
        <Button size="small" isLoading={refresh.isPending} disabled={clashing.size > 0} onClick={() => refresh.mutate()}>
          {t("offerImport.mapping.preview")}
        </Button>
      </div>
    </div>
  )
}
