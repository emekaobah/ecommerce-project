import { Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

type Props = { errors: string[]; warnings: string[]; missing: string[] }

/** A row's errors, repairs made to its cells, and what its product still needs to publish. */
export const RowIssues = ({ errors, warnings, missing }: Props) => {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-y-1 py-2">
      {errors.map((e) => (
        <Text key={e} size="small" className="text-ui-fg-error">
          {e}
        </Text>
      ))}
      {warnings.map((w) => (
        <Text key={w} size="small" className="text-ui-fg-subtle">
          {w}
        </Text>
      ))}
      {missing.length > 0 && (
        <Text size="small" className="text-ui-fg-subtle">
          {t("catalogueImport.missing", { fields: missing.join(", ") })}
        </Text>
      )}
    </div>
  )
}
