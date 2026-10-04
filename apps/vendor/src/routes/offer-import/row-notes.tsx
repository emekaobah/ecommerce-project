import { Text } from "@medusajs/ui"

type Props = { errors: string[]; warnings: string[]; changes?: string[] }

/**
 * A row's errors, what it changes on an offer the shop already has, then the
 * repairs made to its cells and other warnings (a price below cost among them).
 */
export const RowNotes = ({ errors, warnings, changes = [] }: Props) => (
  <div className="flex flex-col gap-y-1 py-2">
    {errors.map((e) => (
      <Text key={e} size="small" className="text-ui-fg-error">
        {e}
      </Text>
    ))}
    {changes.map((c) => (
      <Text key={c} size="small">
        {c}
      </Text>
    ))}
    {warnings.map((w) => (
      <Text key={w} size="small" className="text-ui-fg-subtle">
        {w}
      </Text>
    ))}
  </div>
)
