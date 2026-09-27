import { Button, Hint, Input, Label, Text } from "@medusajs/ui"
import { useMutation } from "@tanstack/react-query"
import { useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { client } from "../../lib/client"
import type { Preview, Sheet } from "./types"

type Props = {
  /** Sources with a saved mapping, most recent first. */
  sources: string[]
  onPreviewed: (sheet: Sheet, preview: Preview) => void
}

/** Picks the file and names its source, whose saved mapping the preview then brings back. */
export const UploadStep = ({ sources, onPreviewed }: Props) => {
  const { t } = useTranslation()
  const sourcesListId = useId()
  const [source, setSource] = useState(sources[0] ?? "")
  const [file, setFile] = useState<File | null>(null)

  const preview = useMutation({
    mutationFn: async () => {
      const sheet: Sheet = { csv: await file!.text(), fileName: file!.name, source: source.trim() }
      const result = await client.admin.catalogueImport.preview.mutate({ csv: sheet.csv, source: sheet.source })
      return { sheet, result }
    },
    onSuccess: ({ sheet, result }) => onPreviewed(sheet, result),
  })

  return (
    <form
      className="flex max-w-lg flex-col gap-y-6"
      onSubmit={(event) => {
        event.preventDefault()
        preview.mutate()
      }}
    >
      <div className="flex flex-col gap-y-2">
        <Label htmlFor="catalogue-import-source" weight="plus">
          {t("catalogueImport.upload.source")}
        </Label>
        <Input
          id="catalogue-import-source"
          list={sourcesListId}
          value={source}
          onChange={(event) => setSource(event.target.value)}
          placeholder={t("catalogueImport.upload.sourcePlaceholder")}
          required
        />
        <datalist id={sourcesListId}>
          {sources.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <Hint>{t("catalogueImport.upload.sourceHint")}</Hint>
      </div>
      <div className="flex flex-col gap-y-2">
        <Label htmlFor="catalogue-import-file" weight="plus">
          {t("catalogueImport.upload.file")}
        </Label>
        <input
          id="catalogue-import-file"
          type="file"
          accept=".csv,text/csv"
          required
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="txt-compact-small text-ui-fg-subtle file:bg-ui-button-neutral file:text-ui-fg-base file:shadow-buttons-neutral file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-1.5"
        />
        <Hint>{t("catalogueImport.upload.fileHint")}</Hint>
      </div>
      {preview.isError && (
        <Text size="small" className="text-ui-fg-error">
          {preview.error.message}
        </Text>
      )}
      <div>
        <Button type="submit" size="small" isLoading={preview.isPending} disabled={!file || !source.trim()}>
          {t("catalogueImport.upload.continue")}
        </Button>
      </div>
    </form>
  )
}
