import { defineWidgetConfig } from "@mercurjs/dashboard-sdk"
import { Container, Heading, Label, Switch, Text, toast } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { client } from "../lib/client"

// The operator marks a catalogue category perishable (#69): its products, and those of its
// sub-categories, are then delivered only by couriers arriving by the end of the next day.
// Shops can't change it; the flag lives behind admin-only routes.
const CategoryPerishableWidget = ({ data }: { data?: { id: string } }) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const categoryId = data?.id
  const queryKey = ["category-perishable", categoryId]
  const { data: standing, isError } = useQuery({
    queryKey,
    queryFn: async () => (await client.admin.productCategories.$id.perishable.query({ $id: categoryId! })).perishable,
    enabled: !!categoryId,
  })
  const save = useMutation({
    mutationFn: async (perishable: boolean) =>
      (await client.admin.productCategories.$id.perishable.mutate({ $id: categoryId!, perishable })).perishable,
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next)
      // Products in this category may have changed with it.
      void queryClient.invalidateQueries({ queryKey: ["product-perishable"] })
      toast.success(t("perishable.saved"))
    },
    onError: (error) => toast.error(error.message),
  })

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">{t("perishable.title")}</Heading>
      </div>
      <div className="flex flex-col gap-y-2 px-6 py-4">
        {isError && (
          <Text size="small" className="text-ui-fg-error">
            {t("perishable.loadError")}
          </Text>
        )}
        {standing && (
          <>
            <div className="flex items-center justify-between gap-x-4">
              <Label htmlFor="category-perishable" size="small">
                {t("perishable.categoryLabel")}
              </Label>
              <Switch
                id="category-perishable"
                checked={standing.perishable}
                disabled={save.isPending}
                onCheckedChange={(checked) => save.mutate(checked)}
              />
            </div>
            <Text size="small" className="text-ui-fg-subtle">
              {t("perishable.categoryHint")}
            </Text>
            {standing.inherited && (
              <Text size="small">{t("perishable.inheritedFromParent")}</Text>
            )}
          </>
        )}
      </div>
    </Container>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- the dashboard SDK reads the zone from this export
export const config = defineWidgetConfig({
  zone: "categories.detail.side.before",
})

export default CategoryPerishableWidget
