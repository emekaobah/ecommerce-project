import { Text } from "@medusajs/ui"

/** A row's errors, then the repairs made to its cells and other warnings (a price below cost among them). */
export const RowNotes = ({ errors, warnings }: { errors: string[]; warnings: string[] }) => (
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
  </div>
)
