import { ArrowUpTray } from "@medusajs/icons"
import { ClientError } from "@mercurjs/client"
import { Container, Heading, ProgressTabs, Text } from "@medusajs/ui"
import type { RouteConfig } from "@mercurjs/dashboard-sdk"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { client } from "../../lib/client"
import { MappingStep } from "./mapping-step"
import { PreviewStep } from "./preview-step"
import { ResultsStep } from "./results-step"
import type { ImportOutcome, ImportSetup, Mapping, Preview, Sheet } from "./types"
import { UploadStep } from "./upload-step"

// eslint-disable-next-line react-refresh/only-export-components -- the dashboard SDK reads the sidebar entry from this export
export const config: RouteConfig = {
  label: "Import product list",
  icon: ArrowUpTray,
  // The sidebar matches this against the parent item's path, not its id.
  nested: "/products",
}

// eslint-disable-next-line react-refresh/only-export-components -- React Router reads the breadcrumb from this export
export const handle = {
  breadcrumb: () => "Import product list",
}

type Step = "upload" | "mapping" | "preview" | "results"
const STEPS: Step[] = ["upload", "mapping", "preview", "results"]

/**
 * Upload the shop's product list, map its columns (the shop's last mapping
 * comes back), preview what each row would do, then import: products the
 * catalogue has become the shop's offers, the rest are proposed for review.
 * The API does the reading and checking; this page walks through it.
 */
const OfferImportPage = () => {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>("upload")
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [mapping, setMapping] = useState<Mapping>({})
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)

  const setup = useQuery<ImportSetup>({
    queryKey: ["offer-import"],
    queryFn: () => client.vendor.offerImport.query(),
  })

  const reached = STEPS.indexOf(step)
  const tabStatus = (s: Step) => {
    const at = STEPS.indexOf(s)
    if (at < reached) return "completed"
    return at === reached ? "in-progress" : "not-started"
  }

  const restart = () => {
    setSheet(null)
    setPreview(null)
    setMapping({})
    setOutcome(null)
    setStep("upload")
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-1 px-6 py-4">
        <Heading>{t("offerImport.title")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t("offerImport.description")}
        </Text>
      </div>
      <ProgressTabs value={step}>
        <ProgressTabs.List className="border-ui-border-base border-b">
          {STEPS.map((s) => (
            <ProgressTabs.Trigger key={s} value={s} status={tabStatus(s)} disabled className="w-full max-w-[200px]">
              {t(`offerImport.steps.${s}`)}
            </ProgressTabs.Trigger>
          ))}
        </ProgressTabs.List>
      </ProgressTabs>
      <div className="px-6 py-6">
        {setup.isError && (
          <Text size="small" className="text-ui-fg-error">
            {/* The import needs offer:create, which fulfilment staff don't have. */}
            {setup.error instanceof ClientError && setup.error.status === 403
              ? t("offerImport.notAllowed")
              : t("offerImport.loadError")}
          </Text>
        )}
        {setup.data && step === "upload" && (
          <UploadStep
            onPreviewed={(nextSheet, nextPreview) => {
              setSheet(nextSheet)
              setPreview(nextPreview)
              setMapping(nextPreview.mapping)
              setStep("mapping")
            }}
          />
        )}
        {setup.data && sheet && preview && step === "mapping" && (
          <MappingStep
            fields={setup.data.fields}
            sheet={sheet}
            preview={preview}
            mapping={mapping}
            onChange={setMapping}
            onBack={restart}
            onPreviewed={(nextPreview) => {
              setPreview(nextPreview)
              setStep("preview")
            }}
          />
        )}
        {sheet && preview && step === "preview" && (
          <PreviewStep
            sheet={sheet}
            preview={preview}
            mapping={mapping}
            onBack={() => setStep("mapping")}
            onImported={(nextOutcome) => {
              setOutcome(nextOutcome)
              setStep("results")
              // The shop now has a saved mapping.
              setup.refetch()
            }}
          />
        )}
        {outcome && step === "results" && <ResultsStep outcome={outcome} onRestart={restart} />}
      </div>
    </Container>
  )
}

export default OfferImportPage
