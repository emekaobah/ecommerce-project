import type { InferClientOutput } from "@mercurjs/client"
import { client } from "../../lib/client"

export type ImportSetup = InferClientOutput<typeof client.vendor.offerImport.query>
export type ImportField = ImportSetup["fields"][number]
export type Preview = InferClientOutput<typeof client.vendor.offerImport.preview.mutate>
export type ImportOutcome = InferClientOutput<typeof client.vendor.offerImport.mutate>
export type Mapping = Record<string, string>

/** The shop's product list, as uploaded. */
export type Sheet = { csv: string; fileName: string }
