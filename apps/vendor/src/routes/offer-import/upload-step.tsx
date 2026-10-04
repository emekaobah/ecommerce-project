import { Button, Hint, Label, Text } from "@medusajs/ui"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { client } from "../../lib/client"
import type { Preview, Sheet } from "./types"

/** Picks the file; the preview brings back the shop's last mapping, or suggests one. */
export const UploadStep = ({ onPreviewed }: { onPreviewed: (sheet: Sheet, preview: Preview) => void }) => {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)

  const preview = useMutation({
    mutationFn: async () => {
      const sheet: Sheet = { csv: await file!.text(), fileName: file!.name }
      return { sheet, result: await client.vendor.offerImport.preview.mutate({ csv: sheet.csv }) }
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
        <Label htmlFor="offer-import-file" weight="plus">
          {t("offerImport.upload.file")}
        </Label>
        <input
          id="offer-import-file"
          type="file"
          accept=".csv,text/csv"
          required
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="txt-compact-small text-ui-fg-subtle file:bg-ui-button-neutral file:text-ui-fg-base file:shadow-buttons-neutral file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-1.5"
        />
        <Hint>{t("offerImport.upload.fileHint")}</Hint>
      </div>
      {preview.isError && (
        <Text size="small" className="text-ui-fg-error">
          {preview.error.message}
        </Text>
      )}
      <div>
        <Button type="submit" size="small" isLoading={preview.isPending} disabled={!file}>
          {t("offerImport.upload.continue")}
        </Button>
      </div>
    </form>
  )
}
