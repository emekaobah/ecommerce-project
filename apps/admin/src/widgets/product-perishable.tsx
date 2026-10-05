import { defineWidgetConfig } from "@mercurjs/dashboard-sdk"
import { Badge, Container, Heading, Label, Select, Text, toast } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { client } from "../lib/client"

type Choice = "follow" | "always" | "never"
const OVERRIDES: Record<Choice, boolean | null> = { follow: null, always: true, never: false }
const choiceOf = (override: boolean | null): Choice => (override === null ? "follow" : override ? "always" : "never")

// Whether this product is perishable (#69): it follows its categories unless the operator
// overrides it here, either way. Shops can't change it.
const ProductPerishableWidget = ({ data }: { data?: { id: string; updated_at?: string | Date | null } }) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const productId = data?.id
  // Refetch whenever the product is saved: its categories may have changed.
  const queryKey = ["product-perishable", productId, String(data?.updated_at ?? "")]
  const { data: standing, isError } = useQuery({
    queryKey,
    queryFn: async () => (await client.admin.products.$id.perishable.query({ $id: productId! })).perishable,
    enabled: !!productId,
  })
  const save = useMutation({
    mutationFn: async (override: boolean | null) =>
      (await client.admin.products.$id.perishable.mutate({ $id: productId!, override })).perishable,
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next)
      toast.success(t("perishable.saved"))
    },
    onError: (error) => toast.error(error.message),
  })
  const yesNo = (value: boolean) => t(value ? "perishable.yes" : "perishable.no")

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">{t("perishable.title")}</Heading>
        {standing && (
          <Badge size="2xsmall" color={standing.perishable ? "orange" : "grey"}>
            {yesNo(standing.perishable)}
          </Badge>
        )}
      </div>
      <div className="flex flex-col gap-y-2 px-6 py-4">
        {isError && (
          <Text size="small" className="text-ui-fg-error">
            {t("perishable.loadError")}
          </Text>
        )}
        {standing && (
          <>
            <Label htmlFor="product-perishable" size="small">
              {t("perishable.productLabel")}
            </Label>
            <Select
              value={choiceOf(standing.override)}
              disabled={save.isPending}
              onValueChange={(value) => save.mutate(OVERRIDES[value as Choice])}
            >
              <Select.Trigger id="product-perishable">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="follow">
                  {t("perishable.follow", { current: yesNo(standing.inherited) })}
                </Select.Item>
                <Select.Item value="always">{t("perishable.always")}</Select.Item>
                <Select.Item value="never">{t("perishable.never")}</Select.Item>
              </Select.Content>
            </Select>
            <Text size="small" className="text-ui-fg-subtle">
              {t("perishable.productHint")}
            </Text>
          </>
        )}
      </div>
    </Container>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- the dashboard SDK reads the zone from this export
export const config = defineWidgetConfig({
  zone: "product.detail.side.before",
})

export default ProductPerishableWidget
