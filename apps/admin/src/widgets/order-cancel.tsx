import { defineWidgetConfig } from "@mercurjs/dashboard-sdk"
import type { InferClientInput, InferClientOutput } from "@mercurjs/client"
import { Button, Container, Drawer, Heading, Label, Select, Text, Textarea, toast } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { client } from "../lib/client"

type CancelPreview = InferClientOutput<typeof client.admin.orders.$id.cancel.query>["cancel"]
type Reason = InferClientInput<typeof client.admin.orders.$id.cancel.mutate>["reason"]

const REASONS: Reason[] = ["items_unavailable", "cannot_fulfil", "buyer_asked", "other"]

const money = (amount: number, currency: string) => `${currency.toUpperCase()} ${amount.toLocaleString()}`

// Oja's staff cancel an accepted order its shop can't fulfil (#17), clearing one stuck between
// Picking and Packed. The buyer is refunded all that is left of this order's share of their
// checkout, never the other shops' orders, and told why. Medusa's own Cancel refunds the whole
// payment, so the API refuses it without a reason; this is the way to cancel.
const OrderCancelWidget = ({ data }: { data?: { id: string; updated_at?: string | Date | null } }) => {
  const { t } = useTranslation()
  const orderId = data?.id
  const queryKey = ["order-cancel", orderId, String(data?.updated_at ?? "")]
  const [open, setOpen] = useState(false)
  const { data: preview } = useQuery<CancelPreview>({
    queryKey,
    queryFn: async () => (await client.admin.orders.$id.cancel.query({ $id: orderId! })).cancel,
    enabled: !!orderId,
  })
  if (!orderId || !preview?.allowed) return null

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">{t("orderCancel.title")}</Heading>
      </div>
      <div className="flex flex-col gap-y-2 px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          {t("orderCancel.hint", { amount: money(preview.refund_amount, preview.currency_code) })}
        </Text>
        <Button size="small" variant="danger" onClick={() => setOpen(true)}>
          {t("orderCancel.open")}
        </Button>
      </div>
      {open && <CancelDrawer orderId={orderId} preview={preview} onClose={() => setOpen(false)} />}
    </Container>
  )
}

/** Asks why the order is cancelled (the buyer is told), and confirms the refund. */
function CancelDrawer({ orderId, preview, onClose }: Readonly<{ orderId: string; preview: CancelPreview; onClose: () => void }>) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [reason, setReason] = useState<Reason>("items_unavailable")
  const [note, setNote] = useState("")
  const cancel = useMutation({
    mutationFn: () => client.admin.orders.$id.cancel.mutate({ $id: orderId, reason, note: note.trim() || undefined }),
    onSuccess: ({ refund }) => {
      // The order's status, payments and totals changed.
      void queryClient.invalidateQueries({ queryKey: ["orders"] })
      void queryClient.invalidateQueries({ queryKey: ["order-cancel", orderId] })
      toast.success(refund ? t("orderCancel.cancelled") : t("orderCancel.cancelledOwed"))
      onClose()
    },
    onError: (error) => toast.error(error.message),
  })
  const needsNote = reason === "other" && !note.trim()

  return (
    <Drawer open onOpenChange={(next) => !next && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{t("orderCancel.title")}</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4">
          <div className="flex flex-col gap-y-2">
            <Label htmlFor="cancel-reason" size="small">
              {t("orderCancel.reason")}
            </Label>
            <Select value={reason} onValueChange={(value) => setReason(value as Reason)}>
              <Select.Trigger id="cancel-reason">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {REASONS.map((r) => (
                  <Select.Item key={r} value={r}>
                    {t(`orderCancel.reasons.${r}`)}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
          <div className="flex flex-col gap-y-2">
            <Label htmlFor="cancel-note" size="small">
              {t(reason === "other" ? "orderCancel.noteRequired" : "orderCancel.note")}
            </Label>
            <Textarea id="cancel-note" value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          <Text size="small">{t("orderCancel.refund", { amount: money(preview.refund_amount, preview.currency_code) })}</Text>
          <Text size="small" className="text-ui-fg-subtle">
            {t("orderCancel.told")}
          </Text>
        </Drawer.Body>
        <Drawer.Footer>
          <Button size="small" variant="secondary" onClick={onClose}>
            {t("orderCancel.back")}
          </Button>
          <Button
            size="small"
            variant="danger"
            disabled={needsNote || cancel.isPending}
            isLoading={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            {t("orderCancel.confirm", { amount: money(preview.refund_amount, preview.currency_code) })}
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- the dashboard SDK reads the zone from this export
export const config = defineWidgetConfig({
  zone: "orders.detail.side.before",
})

export default OrderCancelWidget
