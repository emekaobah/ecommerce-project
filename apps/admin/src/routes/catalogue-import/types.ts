import type { InferClientOutput } from "@mercurjs/client"
import { client } from "../../lib/client"

export type ImportSetup = InferClientOutput<typeof client.admin.catalogueImport.query>
export type ImportField = ImportSetup["fields"][number]
export type Preview = InferClientOutput<typeof client.admin.catalogueImport.preview.mutate>
export type ImportOutcome = InferClientOutput<typeof client.admin.catalogueImport.mutate>
export type Mapping = Record<string, string>

/** The sheet the operator is importing, as uploaded. */
export type Sheet = { csv: string; fileName: string; source: string }
